// Migrations: the reviewed path from one schema version to another. Content lives in
// immutable revisions (answers, plan and script artifacts, shadow verification); only the
// status moves: draft → in_review → approved | rejected, and back to draft whenever a new
// revision is made. An approval belongs to one exact revision and needs a second person:
// an admin or owner who wrote neither the migration nor that revision.
import {
  answersOf,
  openQuestions,
  planMigration,
  type Answer,
  type Answers,
  type MigrationPlan,
  type Risk,
} from "@skematron/core";
import { renderPostgresMigration } from "@skematron/adapters";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Actor } from "./actor.ts";
import { recordAudit } from "./audit.ts";
import { db } from "./db.ts";
import { ForbiddenError, NotFoundError, UserFacingError } from "./errors.ts";
import { assertCan, type Project } from "./projects.ts";
import { verifyMigration } from "./shadow.ts";
import {
  artifacts,
  getVersion,
  loadSnapshot,
  unsupportedOf,
  type SchemaVersion,
} from "./versions.ts";

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

const MAX_TITLE = 120;
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

export async function listMigrations(actor: Actor, project: Project) {
  assertCan(actor, "read");
  return db().migration.findMany({
    where: { projectId: project.id },
    orderBy: { number: "desc" },
    include: {
      fromVersion: { select: { number: true } },
      toVersion: { select: { number: true } },
    },
  });
}

export async function getMigration(
  actor: Actor,
  project: Project,
  number: number,
) {
  assertCan(actor, "read");
  const migration = Number.isSafeInteger(number)
    ? await db().migration.findUnique({
        where: { projectId_number: { projectId: project.id, number } },
        include: {
          fromVersion: true,
          toVersion: true,
          revisions: { orderBy: { number: "desc" } },
          reviews: { orderBy: { createdAt: "desc" } },
        },
      })
    : null;
  if (migration === null)
    throw new NotFoundError(`Migration ${number} not found.`);
  return migration;
}

export type Migration = Awaited<ReturnType<typeof getMigration>>;
export type MigrationRevision = Migration["revisions"][number];

export function latestRevision(migration: Migration): MigrationRevision {
  const latest = migration.revisions[0];
  if (latest === undefined)
    throw new Error(`Migration ${migration.number} has no revision.`);
  return latest;
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

/** Plans, renders, verifies and stores a revision's artifacts. Slow, so it runs before any lock. */
async function prepareRevision(
  fromVersion: SchemaVersion,
  toVersion: SchemaVersion,
  answers: Answers,
) {
  const [from, to] = await Promise.all([
    loadSnapshot(fromVersion),
    loadSnapshot(toVersion),
  ]);
  // Unused answers are dropped: changing one answer can remove other questions.
  const plan = planMigration(from, to, { answers, ignoreUnusedAnswers: true });
  const { script } = renderPostgresMigration(plan);
  const verification = await verifyMigration({
    from,
    fromUnsupported: unsupportedOf(fromVersion),
    plan,
    to,
  });
  const store = artifacts();
  const encoder = new TextEncoder();
  const [planArtifact, scriptArtifact] = await Promise.all([
    store.put(encoder.encode(`${JSON.stringify(plan, null, 2)}\n`)),
    store.put(encoder.encode(script)),
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
      summary: { ...summary },
      openQuestions: openQuestions(plan).length,
      unsupportedChanges: plan.unsupported.length,
      verification: verification.status,
      verificationDetail:
        verification.status === "passed" ? null : verification.detail,
    },
  };
}

export async function createMigration(
  actor: Actor,
  project: Project,
  input: { from: number; to: number; title: string },
) {
  assertCan(actor, "author-migrations");
  const [fromVersion, toVersion] = await Promise.all([
    getVersion(actor, project, input.from),
    getVersion(actor, project, input.to),
  ]);
  if (fromVersion.id === toVersion.id) {
    throw new UserFacingError("Choose two different versions.");
  }
  const title =
    input.title.trim() || `v${fromVersion.number} → v${toVersion.number}`;
  if (title.length > MAX_TITLE) {
    throw new UserFacingError(
      `Keep the title to ${MAX_TITLE} characters or fewer.`,
    );
  }
  const prepared = await prepareRevision(fromVersion, toVersion, {});
  if (
    prepared.plan.operations.length === 0 &&
    prepared.plan.unsupported.length === 0
  ) {
    throw new UserFacingError(
      `v${toVersion.number} is equivalent to v${fromVersion.number}: there is nothing to migrate.`,
    );
  }
  const migration = await db().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`migration-number:${project.id}`}, 0))`;
    const latest = await tx.migration.findFirst({
      where: { projectId: project.id },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return tx.migration.create({
      data: {
        projectId: project.id,
        number: (latest?.number ?? 0) + 1,
        title,
        status: "draft",
        fromVersionId: fromVersion.id,
        toVersionId: toVersion.id,
        createdById: actor.userId,
        revisions: {
          create: { number: 1, ...prepared.data, createdById: actor.userId },
        },
      },
    });
  });
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "migration.create",
    targetType: "migration",
    targetId: migration.id,
    details: {
      project: project.slug,
      number: migration.number,
      from: fromVersion.number,
      to: toVersion.number,
      verification: prepared.data.verification,
    },
  });
  return migration;
}

/** Runs `work` while holding the migration's lock, with its current status and latest revision. */
async function withMigrationLock<T>(
  migration: Migration,
  work: (
    tx: Prisma.TransactionClient,
    current: { status: MigrationStatus; latest: MigrationRevision },
  ) => Promise<T>,
): Promise<T> {
  return db().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`migration:${migration.id}`}, 0))`;
    const { status } = await tx.migration.findUniqueOrThrow({
      where: { id: migration.id },
      select: { status: true },
    });
    const latest = await tx.migrationRevision.findFirstOrThrow({
      where: { migrationId: migration.id },
      orderBy: { number: "desc" },
    });
    return work(tx, { status: statusOf({ status }), latest });
  });
}

/**
 * Re-plans with new answers and records the result as the next revision. Any status goes
 * back to draft: an approval never carries over to different content.
 */
export async function reviseMigration(
  actor: Actor,
  project: Project,
  migration: Migration,
  answers: Answers,
) {
  assertCan(actor, "author-migrations");
  const prepared = await prepareRevision(
    migration.fromVersion,
    migration.toVersion,
    answers,
  );
  const { revision, previous } = await withMigrationLock(
    migration,
    async (tx, current) => {
      const created = await tx.migrationRevision.create({
        data: {
          migrationId: migration.id,
          number: current.latest.number + 1,
          ...prepared.data,
          createdById: actor.userId,
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

export async function submitMigration(
  actor: Actor,
  project: Project,
  migration: Migration,
): Promise<void> {
  assertCan(actor, "author-migrations");
  const revision = await withMigrationLock(
    migration,
    async (tx, { status, latest }) => {
      if (status !== "draft") {
        throw new UserFacingError(
          `Only a draft can be submitted; this migration is ${STATUS_LABELS[status]}.`,
        );
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
          "The shadow database check has not passed for the latest revision.",
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

export async function reviewMigration(
  actor: Actor,
  project: Project,
  migration: Migration,
  input: ReviewInput,
): Promise<void> {
  assertCan(actor, "review-migrations");
  const comment = input.comment.trim();
  if (comment.length > MAX_COMMENT) {
    throw new UserFacingError(
      `Keep the comment to ${MAX_COMMENT} characters or fewer.`,
    );
  }
  if (input.verdict === "rejected" && comment === "") {
    throw new UserFacingError("Say why you are rejecting the migration.");
  }
  const revision = await withMigrationLock(
    migration,
    async (tx, { status, latest }) => {
      if (status !== "in_review") {
        throw new UserFacingError(
          `Only a migration in review can be approved or rejected; this one is ${STATUS_LABELS[status]}.`,
        );
      }
      if (latest.id !== input.revisionId) {
        throw new UserFacingError(
          "The migration changed after you opened it. Review the new revision.",
        );
      }
      if (
        actor.userId === migration.createdById ||
        actor.userId === latest.createdById
      ) {
        throw new ForbiddenError(
          "You cannot review a migration you wrote; another admin or owner has to.",
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
