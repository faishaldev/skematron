"use server";

import { field, runAction, withFlash } from "../../../../../lib/actions.ts";
import { UserFacingError } from "../../../../../lib/errors.ts";
import {
  answersFromForm,
  createMigration,
  getMigration,
  reviewMigration,
  reviseMigration,
  submitMigration,
} from "../../../../../lib/migrations.ts";
import { getProject } from "../../../../../lib/projects.ts";
import { requirePermission } from "../../../../../lib/session.ts";

const projectPath = (slug: string) => `/projects/${encodeURIComponent(slug)}`;
const migrationPath = (slug: string, number: number | string) =>
  `${projectPath(slug)}/migrations/${encodeURIComponent(String(number))}`;

const number = (value: string): number =>
  /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN;

export async function createMigrationAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const from = field(formData, "from");
  const to = field(formData, "to");
  const back = `${projectPath(slug)}/migrations/new?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  await runAction(back, async () => {
    const actor = await requirePermission("author-migrations");
    const project = await getProject(actor, slug);
    const migration = await createMigration(actor, project, {
      from: number(from),
      to: number(to),
      title: field(formData, "title"),
    });
    return withFlash(
      migrationPath(slug, migration.number),
      "notice",
      `Migration M${migration.number} created.`,
    );
  });
}

/** Saves answers as a new revision; also re-runs the shadow check. */
export async function answerQuestionsAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const migrationNumber = field(formData, "migration");
  await runAction(migrationPath(slug, migrationNumber), async () => {
    const actor = await requirePermission("author-migrations");
    const project = await getProject(actor, slug);
    const migration = await getMigration(
      actor,
      project,
      number(migrationNumber),
    );
    const revision = await reviseMigration(
      actor,
      project,
      migration,
      answersFromForm(formData.entries()),
    );
    return withFlash(
      migrationPath(slug, migration.number),
      "notice",
      `Saved revision ${revision.number}. Shadow check: ${revision.verification}.`,
    );
  });
}

export async function submitMigrationAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const migrationNumber = field(formData, "migration");
  await runAction(migrationPath(slug, migrationNumber), async () => {
    const actor = await requirePermission("author-migrations");
    const project = await getProject(actor, slug);
    const migration = await getMigration(
      actor,
      project,
      number(migrationNumber),
    );
    await submitMigration(actor, project, migration);
    return withFlash(
      migrationPath(slug, migration.number),
      "notice",
      "Submitted for review. An admin or owner other than you can approve it.",
    );
  });
}

export async function reviewMigrationAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const migrationNumber = field(formData, "migration");
  await runAction(migrationPath(slug, migrationNumber), async () => {
    const actor = await requirePermission("review-migrations");
    const project = await getProject(actor, slug);
    const migration = await getMigration(
      actor,
      project,
      number(migrationNumber),
    );
    const verdict = field(formData, "verdict");
    if (verdict !== "approved" && verdict !== "rejected") {
      throw new UserFacingError("Choose approve or reject.");
    }
    await reviewMigration(actor, project, migration, {
      verdict,
      revisionId: field(formData, "revision"),
      comment: field(formData, "comment"),
      acknowledgeDestructive:
        field(formData, "acknowledgeDestructive") === "on",
    });
    return withFlash(
      migrationPath(slug, migration.number),
      "notice",
      verdict === "approved" ? "Migration approved." : "Migration rejected.",
    );
  });
}
