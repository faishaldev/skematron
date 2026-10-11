// Migrations: the review of a branch, from its base version to its head (lib/branches.ts
// owns the workflow around it). Content lives in immutable revisions (answers, plan and
// script artifacts, the head they planned towards, shadow verification); only the status
// moves: draft → in_review → approved | rejected, and back to draft whenever the branch or
// its answers change. An approval belongs to one exact revision and needs a second person:
// an admin or owner who wrote neither the migration nor that revision.
import {
  answersOf,
  openQuestions,
  planMigration,
  serializeSnapshot,
  type Answer,
  type Answers,
  type MigrationPlan,
  type Risk,
  type SchemaSnapshot,
} from "@skematron/core";
import {
  renderPostgresMigration,
  type UnsupportedObject,
} from "@skematron/adapters";
import type {
  MigrationRevision as MigrationRevisionRow,
  Prisma,
} from "../generated/prisma/client.ts";
import type { Actor } from "./actor.ts";
import { recordAudit } from "./audit.ts";
import { db } from "./db.ts";
import { ForbiddenError, UserFacingError } from "./errors.ts";
import { assertCan, type Project } from "./projects.ts";
import { verifyMigration } from "./shadow.ts";
import { artifacts } from "./versions.ts";

export type MigrationStatus = "draft" | "in_review" | "approved" | "rejected";

export const STATUS_LABELS: Record<MigrationStatus, string> = {
  draft: "draft",
  in_review: "in review",
  approved: "approved",
  rejected: "rejected",
};

export interface RevisionSummary {
  total: number;
  safe: number;
  caution: number;
  destructive: number;
}

const MAX_COMMENT = 2000;
const MAX_BACKFILL = 1000;

export function statusOf(migration: { status: string }): MigrationStatus {
  return migration.status in STATUS_LABELS
    ? (migration.status as MigrationStatus)
    : "draft";
}

export function summaryOf(revision: { summary: unknown }): RevisionSummary {
  return revision.summary as RevisionSummary;
}

/** A migration as loaded with its branch: revisions and reviews newest first. */
export interface Migration {
  id: string;
  number: number;
  status: string;
  createdById: string;
  revisions: MigrationRevision[];
  reviews: {
    id: string;
    revisionId: string;
    reviewerId: string;
    verdict: string;
    comment: string | null;
    acknowledgedDestructive: boolean;
    createdAt: Date;
  }[];
}

export type MigrationRevision = MigrationRevisionRow;

export function latestRevision(
  migration: Pick<Migration, "revisions"> | null,
): MigrationRevision | null {
  return migration?.revisions[0] ?? null;
}

/** The stored plan and script of a revision, verified against their checksums. */
export async function loadRevision(
  revision: MigrationRevision,
): Promise<{ plan: MigrationPlan; script: string }> {
  const store = artifacts();
  const decoder = new TextDecoder();
  const [plan, script] = await Promise.all([
    store.get(revision.planChecksum),
    store.get(revision.scriptChecksum),
  ]);
  return {
    plan: JSON.parse(decoder.decode(plan)) as MigrationPlan,
    script: decoder.decode(script),
  };
}

/**
 * Plans `from` → `to` with the answers, renders and test-runs the plan in the shadow
 * database, and stores the plan, the script and `to` as artifacts. Slow, so it runs before
 * any lock.
 */
export async function prepareRevision(
  input: {
    from: SchemaSnapshot;
    fromUnsupported: readonly UnsupportedObject[];
    to: SchemaSnapshot;
  },
  answers: Answers,
) {
  // Unused answers are dropped: changing one answer can remove other questions.
  const plan = planMigration(input.from, input.to, {
    answers,
    ignoreUnusedAnswers: true,
  });
  const { script } = renderPostgresMigration(plan);
  const verification = await verifyMigration({
    from: input.from,
    fromUnsupported: input.fromUnsupported,
    plan,
    to: input.to,
  });
  const store = artifacts();
  const encoder = new TextEncoder();
  const [planArtifact, scriptArtifact, toArtifact] = await Promise.all([
    store.put(encoder.encode(`${JSON.stringify(plan, null, 2)}\n`)),
    store.put(encoder.encode(script)),
    store.put(encoder.encode(serializeSnapshot(input.to))),
  ]);
  const count = (risk: Risk) =>
    plan.operations.filter((planned) => planned.risk === risk).length;
  const summary: RevisionSummary = {
    total: plan.operations.length,
    safe: count("safe"),
    caution: count("caution"),
    destructive: count("destructive"),
  };
  return {
    plan,
    data: {
      answers: answersOf(plan),
      planChecksum: planArtifact.checksum,
      scriptChecksum: scriptArtifact.checksum,
      toChecksum: toArtifact.checksum,
      summary: { ...summary },
      openQuestions: openQuestions(plan).length,
      unsupportedChanges: plan.unsupported.length,
      verification: verification.status,
      verificationDetail:
        verification.status === "passed" ? null : verification.detail,
    },
  };
}

/** Runs `work` while holding the migration's lock, with its current status and latest revision. */
async function withMigrationLock<T>(
  migration: Pick<Migration, "id">,
  work: (
    tx: Prisma.TransactionClient,
    current: { status: MigrationStatus; latest: MigrationRevision | null },
  ) => Promise<T>,
): Promise<T> {
  return db().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`migration:${migration.id}`}, 0))`;
    const { status } = await tx.migration.findUniqueOrThrow({
      where: { id: migration.id },
      select: { status: true },
    });
    const latest = await tx.migrationRevision.findFirst({
      where: { migrationId: migration.id },
      orderBy: { number: "desc" },
    });
    return work(tx, { status: statusOf({ status }), latest });
  });
}

/**
 * Records a prepared revision as the migration's next one and returns the migration to
 * draft: an approval never carries over to different content. `stillCurrent` runs inside
 * the lock and refuses the revision when what it was prepared from has changed since.
 */
export async function addRevision(
  actor: Actor,
  project: Project,
  migration: Pick<Migration, "id" | "number">,
  prepared: Awaited<ReturnType<typeof prepareRevision>>,
  stillCurrent: (tx: Prisma.TransactionClient) => Promise<boolean>,
): Promise<MigrationRevision> {
  const { revision, previous } = await withMigrationLock(
    migration,
    async (tx, current) => {
      if (!(await stillCurrent(tx))) {
        throw new UserFacingError(
          "The branch changed while the test was running. Run the test again.",
        );
      }
      const created = await tx.migrationRevision.create({
        data: {
          migrationId: migration.id,
          number: (current.latest?.number ?? 0) + 1,
          ...prepared.data,
          createdById: actor.userId,
          // The app's clock, like the branch's updatedAt it is compared with.
          createdAt: new Date(),
        },
      });
      await tx.migration.update({
        where: { id: migration.id },
        data: { status: "draft" },
      });
      return { revision: created, previous: current.status };
    },
  );
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "migration.revise",
    targetType: "migration",
    targetId: migration.id,
    details: {
      project: project.slug,
      number: migration.number,
      revision: revision.number,
      previousStatus: previous,
      verification: revision.verification,
    },
  });
  return revision;
}

/** `current`: the latest revision still matches the branch (the caller checks that). */
export async function submitMigration(
  actor: Actor,
  project: Project,
  migration: Pick<Migration, "id" | "number">,
  current: (latest: MigrationRevision) => boolean,
): Promise<void> {
  assertCan(actor, "author-migrations");
  const revision = await withMigrationLock(
    migration,
    async (tx, { status, latest }) => {
      if (status !== "draft") {
        throw new UserFacingError(
          `Only a draft can be submitted; this one is ${STATUS_LABELS[status]}.`,
        );
      }
      if (latest === null || !current(latest)) {
        throw new UserFacingError(
          "Run the test on the latest changes before submitting.",
        );
      }
      if (summaryOf(latest).total === 0) {
        throw new UserFacingError("There are no changes to submit yet.");
      }
      if (latest.openQuestions > 0) {
        throw new UserFacingError(
          "Answer the open questions before submitting.",
        );
      }
      if (latest.unsupportedChanges > 0) {
        throw new UserFacingError(
          "The plan has changes Skematron cannot express, so it cannot be submitted.",
        );
      }
      if (latest.verification !== "passed") {
        throw new UserFacingError(
          "The test run has not passed for the latest changes.",
        );
      }
      await tx.migration.update({
        where: { id: migration.id },
        data: { status: "in_review" },
      });
      return latest;
    },
  );
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "migration.submit",
    targetType: "migration",
    targetId: migration.id,
    details: {
      project: project.slug,
      number: migration.number,
      revision: revision.number,
    },
  });
}

export interface ReviewInput {
  verdict: "approved" | "rejected";
  /** The revision the reviewer looked at; it must still be the latest. */
  revisionId: string;
  comment: string;
  acknowledgeDestructive: boolean;
}

/** `authorIds`: everyone who worked on the change; none of them may review it. */
export async function reviewMigration(
  actor: Actor,
  project: Project,
  migration: Pick<Migration, "id" | "number" | "createdById">,
  input: ReviewInput,
  authorIds: readonly string[],
): Promise<void> {
  assertCan(actor, "review-migrations");
  const comment = input.comment.trim();
  if (comment.length > MAX_COMMENT) {
    throw new UserFacingError(
      `Keep the comment to ${MAX_COMMENT} characters or fewer.`,
    );
  }
  if (input.verdict === "rejected" && comment === "") {
    throw new UserFacingError("Say why you are rejecting the changes.");
  }
  const revision = await withMigrationLock(
    migration,
    async (tx, { status, latest }) => {
      if (status !== "in_review") {
        throw new UserFacingError(
          `Only changes in review can be approved or rejected; these are ${STATUS_LABELS[status]}.`,
        );
      }
      if (latest === null || latest.id !== input.revisionId) {
        throw new UserFacingError(
          "The branch changed after you opened it. Review the new revision.",
        );
      }
      if (
        actor.userId === migration.createdById ||
        actor.userId === latest.createdById ||
        authorIds.includes(actor.userId)
      ) {
        throw new ForbiddenError(
          "You cannot review changes you wrote; another admin or owner has to.",
        );
      }
      const destructive = summaryOf(latest).destructive;
      if (
        input.verdict === "approved" &&
        destructive > 0 &&
        !input.acknowledgeDestructive
      ) {
        throw new UserFacingError(
          `This revision has ${destructive} destructive ${destructive === 1 ? "operation" : "operations"}. Confirm that you reviewed them.`,
        );
      }
      await tx.migrationReview.create({
        data: {
          migrationId: migration.id,
          revisionId: latest.id,
          reviewerId: actor.userId,
          verdict: input.verdict,
          comment: comment === "" ? null : comment,
          acknowledgedDestructive:
            input.verdict === "approved" && destructive > 0,
        },
      });
      await tx.migration.update({
        where: { id: migration.id },
        data: { status: input.verdict },
      });
      return latest;
    },
  );
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action:
      input.verdict === "approved" ? "migration.approve" : "migration.reject",
    targetType: "migration",
    targetId: migration.id,
    details: {
      project: project.slug,
      number: migration.number,
      revision: revision.number,
    },
  });
}

/**
 * Reads answers from the migration form: `answer:<question id>` holds `rename:<name>`,
 * `drop`, `backfill` or `skip`, and `value:<question id>` holds a backfill value.
 * Core checks the answers against the questions.
 */
export function answersFromForm(
  entries: Iterable<[string, FormDataEntryValue]>,
): Answers {
  const fields = new Map<string, string>();
  for (const [key, value] of entries) {
    if (typeof value === "string") fields.set(key, value);
  }
  const answers = new Map<string, Answer>();
  for (const [key, choice] of fields) {
    if (!key.startsWith("answer:") || choice === "") continue;
    const id = key.slice("answer:".length);
    // Question ids are JSON arrays; anything else is not an answer.
    if (!id.startsWith("[")) continue;
    if (choice === "drop") answers.set(id, { choice: "drop" });
    else if (choice === "skip") answers.set(id, { choice: "skip" });
    else if (choice.startsWith("rename:")) {
      answers.set(id, { choice: "rename", to: choice.slice("rename:".length) });
    } else if (choice === "backfill") {
      const value = fields.get(`value:${id}`) ?? "";
      if (value === "") {
        throw new UserFacingError(
          "Enter a value for existing rows, or choose not to backfill.",
        );
      }
      if (value.length > MAX_BACKFILL || value.includes("\0")) {
        throw new UserFacingError(
          `Backfill values are limited to ${MAX_BACKFILL} characters, without NUL.`,
        );
      }
      answers.set(id, { choice: "backfill", value });
    } else {
      throw new UserFacingError("The form contains an unknown answer.");
    }
  }
  return Object.fromEntries(answers);
}
