// Branches: proposed changes to a project's schema. A branch starts from the latest version
// on main (its base) with a copy of that schema (its head). People change the head (the
// schema editor for "dashboard" projects, schema.prisma uploads for "code" projects), test
// it and get it reviewed through its migration, then merge it (the head becomes the next
// version on main) or close it (nothing is recorded). Apart from the first version (the
// baseline), main only grows through merged branches.
import {
  emptySnapshot,
  isEmptyPlan,
  planMigration,
  serializeSnapshot,
  snapshotChecksum,
  type Answers,
  type MigrationPlan,
  type SchemaSnapshot,
} from "@skematron/core";
import type { UnsupportedObject } from "@skematron/adapters";
import type { Actor } from "./actor.ts";
import { recordAudit } from "./audit.ts";
import { db } from "./db.ts";
import { isUniqueViolation, NotFoundError, UserFacingError } from "./errors.ts";
import {
  addRevision,
  latestRevision,
  prepareRevision,
  reviewMigration,
  statusOf,
  submitMigration,
  type MigrationRevision,
  type ReviewInput,
} from "./migrations.ts";
import { prismaSnapshot } from "./prisma-import.ts";
import {
  assertCan,
  requireSchemaSource,
  type Environment,
  type Project,
} from "./projects.ts";
import { applyEdit, type SchemaEdit } from "./schema-edits.ts";
import { normalizeSnapshot } from "./shadow.ts";
import { readLive } from "./targets.ts";
import {
  listVersions,
  loadSnapshot,
  recordVersion,
  unsupportedOf,
  type SchemaVersion,
} from "./versions.ts";

export type BranchStatus = "open" | "merged" | "closed";

const BRANCH_NAME = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

const STALE =
  "This branch changed while you were working on it. Reload the page and try again.";

const json = (snapshot: SchemaSnapshot) =>
  JSON.parse(serializeSnapshot(snapshot)) as object;

export function branchStatusOf(branch: { status: string }): BranchStatus {
  return branch.status === "merged" || branch.status === "closed"
    ? branch.status
    : "open";
}

export async function listBranches(actor: Actor, project: Project) {
  assertCan(actor, "read");
  return db().branch.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    include: {
      baseVersion: { select: { number: true } },
      mergedVersion: { select: { number: true } },
      migration: { select: { status: true } },
    },
  });
}

export async function getBranch(actor: Actor, project: Project, name: string) {
  assertCan(actor, "read");
  const branch = BRANCH_NAME.test(name)
    ? await db().branch.findUnique({
        where: { projectId_name: { projectId: project.id, name } },
        include: {
          baseVersion: true,
          mergedVersion: { select: { number: true } },
          migration: {
            include: {
              revisions: { orderBy: { number: "desc" } },
              reviews: { orderBy: { createdAt: "desc" } },
            },
          },
        },
      })
    : null;
  if (branch === null) throw new NotFoundError("Branch not found.");
  return branch;
}

export type Branch = Awaited<ReturnType<typeof getBranch>>;

export function headOf(branch: { head: unknown }): SchemaSnapshot {
  return branch.head as SchemaSnapshot;
}

export function headUnsupportedOf(branch: {
  headUnsupported: unknown;
}): UnsupportedObject[] {
  return Array.isArray(branch.headUnsupported)
    ? (branch.headUnsupported as UnsupportedObject[])
    : [];
}

/** The base the branch compares against: its version, or empty before the first version. */
export async function baseOf(branch: {
  baseVersion: SchemaVersion | null;
}): Promise<{ snapshot: SchemaSnapshot; unsupported: UnsupportedObject[] }> {
  return branch.baseVersion === null
    ? { snapshot: emptySnapshot("postgresql"), unsupported: [] }
    : {
        snapshot: await loadSnapshot(branch.baseVersion),
        unsupported: unsupportedOf(branch.baseVersion),
      };
}

/** Whether the latest test run was made after the branch's last change. */
export function testedRevision(branch: Branch): MigrationRevision | null {
  const latest = latestRevision(branch.migration);
  return latest !== null && latest.createdAt > branch.updatedAt ? latest : null;
}

/** The branch's changes right now, with the answers given so far. */
export async function branchPlan(branch: Branch): Promise<MigrationPlan> {
  const answers = (latestRevision(branch.migration)?.answers ?? {}) as Answers;
  return planMigration((await baseOf(branch)).snapshot, headOf(branch), {
    answers,
    ignoreUnusedAnswers: true,
  });
}

/** Everyone who worked on the branch; none of them may review it. */
export function authorsOf(branch: Branch): string[] {
  return [
    ...new Set([
      branch.createdById,
      ...branch.contributorIds,
      ...(branch.migration?.revisions.map((r) => r.createdById) ?? []),
    ]),
  ];
}

function requireOpen(branch: { status: string }): void {
  const status = branchStatusOf(branch);
  if (status !== "open") {
    throw new UserFacingError(
      `This branch is ${status}, so it can no longer change.`,
    );
  }
}

async function insertBranch(
  actor: Actor,
  project: Project,
  input: {
    name: string;
    base: SchemaVersion | null;
    head: SchemaSnapshot;
    unsupported: readonly UnsupportedObject[];
    source: Record<string, string>;
  },
) {
  let branch;
  try {
    branch = await db().branch.create({
      data: {
        projectId: project.id,
        name: input.name,
        status: "open",
        baseVersionId: input.base?.id ?? null,
        head: json(input.head),
        headUnsupported: input.unsupported.map((object) => ({ ...object })),
        headSource: input.source,
        createdById: actor.userId,
        contributorIds: [actor.userId],
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserFacingError(
        `A branch named ${input.name} already exists in this project.`,
      );
    }
    throw error;
  }
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "branch.create",
    targetType: "branch",
    targetId: branch.id,
    details: {
      project: project.slug,
      branch: branch.name,
      base: input.base?.number ?? null,
      from: input.source.kind ?? null,
    },
  });
  return branch;
}

/** Starts a branch from the latest version on main (or from nothing before the first one). */
export async function createBranch(
  actor: Actor,
  project: Project,
  input: { name: string },
) {
  assertCan(actor, "author-migrations");
  const name = input.name.trim().toLowerCase();
  if (!BRANCH_NAME.test(name)) {
    throw new UserFacingError(
      "Branch names use lowercase letters, digits and dashes, e.g. add-phone-number.",
    );
  }
  const latest = (await listVersions(actor, project))[0] ?? null;
  return insertBranch(actor, project, {
    name,
    base: latest,
    head:
      latest === null
        ? emptySnapshot("postgresql")
        : await loadSnapshot(latest),
    unsupported: latest === null ? [] : unsupportedOf(latest),
    source: { kind: "base" },
  });
}

/**
 * Replaces the head. Refused if anyone changed the branch since it was loaded, so two
 * people never overwrite each other. Any review status goes back to draft.
 */
async function updateHead(
  actor: Actor,
  project: Project,
  branch: Branch,
  head: {
    snapshot: SchemaSnapshot;
    unsupported: readonly UnsupportedObject[];
    source: Record<string, string>;
  },
): Promise<void> {
  requireOpen(branch);
  const updated = await db().$transaction(async (tx) => {
    const result = await tx.branch.updateMany({
      where: { id: branch.id, status: "open", updatedAt: branch.updatedAt },
      data: {
        head: json(head.snapshot),
        headUnsupported: head.unsupported.map((object) => ({ ...object })),
        headSource: head.source,
        contributorIds: [...new Set([...branch.contributorIds, actor.userId])],
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) return false;
    await tx.migration.updateMany({
      where: { branchId: branch.id, status: { not: "draft" } },
      data: { status: "draft" },
    });
    return true;
  });
  if (!updated) throw new UserFacingError(STALE);
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "branch.update",
    targetType: "branch",
    targetId: branch.id,
    details: {
      project: project.slug,
      branch: branch.name,
      from: head.source.kind ?? null,
    },
  });
}

/** One schema editor change ("dashboard" projects), checked by PostgreSQL first. */
export async function editBranch(
  actor: Actor,
  project: Project,
  branch: Branch,
  edit: SchemaEdit,
): Promise<void> {
  assertCan(actor, "author-migrations");
  requireOpen(branch);
  requireSchemaSource(project, "dashboard");
  const edited = applyEdit(headOf(branch), edit);
  const normalized = await normalizeSnapshot(edited, headUnsupportedOf(branch));
  await updateHead(actor, project, branch, {
    snapshot: normalized.snapshot,
    unsupported: normalized.unsupported,
    source: { kind: "editor" },
  });
}

/** Replaces the head with an uploaded schema.prisma ("code" projects). */
export async function uploadPrismaToBranch(
  actor: Actor,
  project: Project,
  branch: Branch,
  text: string,
): Promise<{ removed: string[] }> {
  assertCan(actor, "author-migrations");
  requireOpen(branch);
  requireSchemaSource(project, "code");
  const imported = await prismaSnapshot(text);
  await updateHead(actor, project, branch, imported);
  return { removed: imported.removed };
}

export type EnvironmentImport =
  | { kind: "version"; number: number }
  | { kind: "unchanged"; number: number }
  | { kind: "branch"; name: string };

/**
 * Reads a database (read-only). Before the first version, its schema becomes v1 (the
 * baseline). After that, a difference from main becomes a new branch, so it is reviewed
 * like any other change.
 */
export async function importEnvironment(
  actor: Actor,
  project: Project,
  environment: Environment,
): Promise<EnvironmentImport> {
  assertCan(actor, "use-databases");
  const live = await readLive(environment);
  const source = {
    kind: "introspection",
    adapter: "postgresql",
    environmentId: environment.id,
    environmentName: environment.name,
    serverVersion: live.serverVersion,
  };
  const latest = (await listVersions(actor, project))[0];
  if (latest === undefined) {
    const result = await recordVersion(actor, project, {
      snapshot: live.snapshot,
      unsupported: live.unsupported,
      source,
      basedOn: { versionId: null },
    });
    return { kind: "version", number: result.number };
  }
  if (isEmptyPlan(planMigration(await loadSnapshot(latest), live.snapshot))) {
    return { kind: "unchanged", number: latest.number };
  }
  assertCan(actor, "author-migrations");
  const taken = new Set(
    (
      await db().branch.findMany({
        where: { projectId: project.id },
        select: { name: true },
      })
    ).map((branch) => branch.name),
  );
  const prefix = `from-${environment.name}`;
  let name = prefix;
  for (let suffix = 2; taken.has(name); suffix += 1)
    name = `${prefix}-${suffix}`;
  await insertBranch(actor, project, {
    name,
    base: latest,
    head: live.snapshot,
    unsupported: live.unsupported,
    source,
  });
  return { kind: "branch", name };
}

/**
 * Plans the branch with the answers (or the previous ones), test-runs it in the shadow
 * database, and records the result as the migration's next revision.
 */
export async function testBranch(
  actor: Actor,
  project: Project,
  branch: Branch,
  answers: Answers | null,
): Promise<MigrationRevision> {
  assertCan(actor, "author-migrations");
  requireOpen(branch);
  const previous = latestRevision(branch.migration);
  const base = await baseOf(branch);
  const prepared = await prepareRevision(
    {
      from: base.snapshot,
      fromUnsupported: base.unsupported,
      to: headOf(branch),
    },
    answers ?? ((previous?.answers ?? {}) as Answers),
  );
  const migration =
    branch.migration ?? (await createMigration(actor, project, branch));
  return addRevision(actor, project, migration, prepared, async (tx) => {
    const current = await tx.branch.findUnique({
      where: { id: branch.id },
      select: { status: true, updatedAt: true },
    });
    return (
      current?.status === "open" &&
      current.updatedAt.getTime() === branch.updatedAt.getTime()
    );
  });
}

async function createMigration(actor: Actor, project: Project, branch: Branch) {
  return db().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`migration-number:${project.id}`}, 0))`;
    const existing = await tx.migration.findUnique({
      where: { branchId: branch.id },
    });
    if (existing !== null) return existing;
    const latest = await tx.migration.findFirst({
      where: { projectId: project.id },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return tx.migration.create({
      data: {
        projectId: project.id,
        number: (latest?.number ?? 0) + 1,
        title: branch.name,
        status: "draft",
        branchId: branch.id,
        fromVersionId: branch.baseVersionId,
        createdById: branch.createdById,
      },
    });
  });
}

export async function submitBranch(
  actor: Actor,
  project: Project,
  branch: Branch,
): Promise<void> {
  assertCan(actor, "author-migrations");
  requireOpen(branch);
  if (branch.migration === null) {
    throw new UserFacingError("Run the test before submitting.");
  }
  await submitMigration(
    actor,
    project,
    branch.migration,
    (latest) => latest.createdAt > branch.updatedAt,
  );
}

export async function reviewBranch(
  actor: Actor,
  project: Project,
  branch: Branch,
  input: ReviewInput,
): Promise<void> {
  assertCan(actor, "review-migrations");
  requireOpen(branch);
  if (branch.migration === null) {
    throw new UserFacingError("This branch has not been submitted.");
  }
  await reviewMigration(
    actor,
    project,
    branch.migration,
    input,
    authorsOf(branch),
  );
}

/**
 * Moves the branch's base to the latest version on main. The head stays as it is, so the
 * changes are then shown against the new base: anything that would undo newer work on main
 * becomes visible in the list, and the branch needs a new test and review.
 */
export async function rebaseBranch(
  actor: Actor,
  project: Project,
  branch: Branch,
): Promise<{ number: number }> {
  assertCan(actor, "author-migrations");
  requireOpen(branch);
  const latest = (await listVersions(actor, project))[0];
  if (latest === undefined || latest.id === branch.baseVersionId) {
    throw new UserFacingError(
      "The branch already starts from the latest version.",
    );
  }
  const updated = await db().$transaction(async (tx) => {
    const result = await tx.branch.updateMany({
      where: { id: branch.id, status: "open", updatedAt: branch.updatedAt },
      data: {
        baseVersionId: latest.id,
        contributorIds: [...new Set([...branch.contributorIds, actor.userId])],
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) return false;
    await tx.migration.updateMany({
      where: { branchId: branch.id },
      data: { status: "draft", fromVersionId: latest.id },
    });
    return true;
  });
  if (!updated) throw new UserFacingError(STALE);
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "branch.rebase",
    targetType: "branch",
    targetId: branch.id,
    details: {
      project: project.slug,
      branch: branch.name,
      from: branch.baseVersion?.number ?? null,
      to: latest.number,
    },
  });
  return { number: latest.number };
}

/** Closes the branch without recording anything on main. */
export async function closeBranch(
  actor: Actor,
  project: Project,
  branch: Branch,
): Promise<void> {
  assertCan(actor, "author-migrations");
  requireOpen(branch);
  const result = await db().branch.updateMany({
    where: { id: branch.id, status: "open" },
    data: { status: "closed", closedAt: new Date() },
  });
  if (result.count === 0) throw new UserFacingError(STALE);
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "branch.close",
    targetType: "branch",
    targetId: branch.id,
    details: { project: project.slug, branch: branch.name },
  });
}

/**
 * Records the approved head as the next version on main. Requires an approval of the
 * latest revision, made after the branch's last change, for exactly this head, and main
 * still at the branch's base.
 */
export async function mergeBranch(
  actor: Actor,
  project: Project,
  branch: Branch,
): Promise<{ number: number }> {
  assertCan(actor, "author-migrations");
  requireOpen(branch);
  const migration = branch.migration;
  if (migration === null || statusOf(migration) !== "approved") {
    throw new UserFacingError(
      "A branch can be merged once its changes are approved.",
    );
  }
  const tested = testedRevision(branch);
  const approval = migration.reviews[0];
  const head = headOf(branch);
  if (
    tested === null ||
    approval?.verdict !== "approved" ||
    approval.revisionId !== tested.id ||
    tested.toChecksum !== (await snapshotChecksum(head))
  ) {
    throw new UserFacingError(
      "The branch changed after it was approved. Test it and get it reviewed again.",
    );
  }
  const via = branch.headSource as Record<string, unknown>;
  const source: Record<string, string> = {
    kind: "branch",
    branch: branch.name,
    baseVersion:
      branch.baseVersion === null ? "none" : String(branch.baseVersion.number),
    via: typeof via.kind === "string" ? via.kind : "editor",
  };
  for (const [key, value] of Object.entries(via)) {
    if (key !== "kind" && typeof value === "string") source[key] = value;
  }
  const result = await recordVersion(actor, project, {
    snapshot: head,
    unsupported: headUnsupportedOf(branch),
    source,
    basedOn: { versionId: branch.baseVersionId },
    onCreated: async (tx, version) => {
      const merged = await tx.branch.updateMany({
        where: { id: branch.id, status: "open", updatedAt: branch.updatedAt },
        data: { status: "merged", mergedVersionId: version.id },
      });
      if (merged.count === 0) throw new UserFacingError(STALE);
      await tx.migration.update({
        where: { id: migration.id },
        data: { toVersionId: version.id },
      });
    },
  });
  if (result.status !== "created") {
    throw new UserFacingError(
      `Main already has exactly this schema (v${result.number}). Close the branch instead.`,
    );
  }
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "branch.merge",
    targetType: "branch",
    targetId: branch.id,
    details: {
      project: project.slug,
      branch: branch.name,
      version: result.number,
    },
  });
  return { number: result.number };
}
