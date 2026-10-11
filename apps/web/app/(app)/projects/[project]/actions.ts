"use server";

import {
  field,
  runAction,
  uploadedText,
  withFlash,
} from "../../../../lib/actions.ts";
import { UserFacingError } from "../../../../lib/errors.ts";
import {
  importPrismaSchema,
  MAX_PRISMA_SCHEMA_BYTES,
} from "../../../../lib/prisma-import.ts";
import {
  describeSkipped,
  importSqlSchema,
  MAX_SQL_SCRIPT_BYTES,
} from "../../../../lib/sql-import.ts";
import {
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  getProject,
  parseSchemaSource,
  setSchemaSource,
  updateEnvironment,
  type EnvironmentInput,
} from "../../../../lib/projects.ts";
import { requirePermission } from "../../../../lib/session.ts";
import { readLive } from "../../../../lib/targets.ts";
import { importEnvironment } from "../../../../lib/branches.ts";

const projectPath = (slug: string) => `/projects/${encodeURIComponent(slug)}`;
const environmentPath = (slug: string, name: string) =>
  `${projectPath(slug)}/environments/${encodeURIComponent(name)}`;

function environmentInput(formData: FormData): EnvironmentInput {
  return {
    name: field(formData, "name"),
    connectionUrl: field(formData, "connectionUrl"),
    namespaces: field(formData, "namespaces").split(/[\s,]+/),
  };
}

export async function createEnvironmentAction(
  formData: FormData,
): Promise<void> {
  const slug = field(formData, "project");
  await runAction(`${projectPath(slug)}/environments/new`, async () => {
    const actor = await requirePermission("manage-projects");
    const project = await getProject(actor, slug);
    const environment = await createEnvironment(
      actor,
      project,
      environmentInput(formData),
    );
    return withFlash(
      environmentPath(slug, environment.name),
      "notice",
      `Environment ${environment.name} added. Test the connection, then import a version.`,
    );
  });
}

export async function updateEnvironmentAction(
  formData: FormData,
): Promise<void> {
  const slug = field(formData, "project");
  const current = field(formData, "environment");
  await runAction(environmentPath(slug, current), async () => {
    const actor = await requirePermission("manage-projects");
    const project = await getProject(actor, slug);
    const environment = await getEnvironment(actor, project, current);
    const updated = await updateEnvironment(
      actor,
      project,
      environment,
      environmentInput(formData),
    );
    return withFlash(
      environmentPath(slug, updated.name),
      "notice",
      "Environment saved.",
    );
  });
}

export async function deleteEnvironmentAction(
  formData: FormData,
): Promise<void> {
  const slug = field(formData, "project");
  const name = field(formData, "environment");
  await runAction(environmentPath(slug, name), async () => {
    const actor = await requirePermission("manage-projects");
    const project = await getProject(actor, slug);
    await deleteEnvironment(
      actor,
      project,
      await getEnvironment(actor, project, name),
    );
    return withFlash(
      projectPath(slug),
      "notice",
      `Environment ${name} deleted. Its versions are kept.`,
    );
  });
}

export async function testConnectionAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const name = field(formData, "environment");
  await runAction(environmentPath(slug, name), async () => {
    const actor = await requirePermission("use-databases");
    const project = await getProject(actor, slug);
    const environment = await getEnvironment(actor, project, name);
    const { snapshot, serverVersion, unsupported } =
      await readLive(environment);
    const tables = snapshot.namespaces
      .map(
        (namespace) => `${namespace.name}: ${namespace.tables.length} tables`,
      )
      .join(", ");
    return withFlash(
      environmentPath(slug, name),
      "notice",
      `Connected to PostgreSQL ${serverVersion} (read-only). ${tables}. ${unsupported.length} objects not captured.`,
    );
  });
}

export async function importVersionAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const name = field(formData, "environment");
  const back =
    field(formData, "back") === "environment"
      ? environmentPath(slug, name)
      : projectPath(slug);
  await runAction(back, async () => {
    const actor = await requirePermission("use-databases");
    const project = await getProject(actor, slug);
    const environment = await getEnvironment(actor, project, name);
    const result = await importEnvironment(actor, project, environment);
    switch (result.kind) {
      case "version":
        return withFlash(
          `${projectPath(slug)}/versions/${result.number}`,
          "notice",
          `Imported ${name} as version ${result.number}, the starting point on main.`,
        );
      case "unchanged":
        return withFlash(
          back,
          "notice",
          `No changes: ${name} still matches v${result.number} on main.`,
        );
      case "branch":
        return withFlash(
          `${projectPath(slug)}/branches/${result.name}`,
          "notice",
          `${name} differs from main. Its schema is in the new branch ${result.name}, so the difference can be reviewed before it reaches main.`,
        );
    }
  });
}

/** The baseline from a schema file: SQL (any tool) or a schema.prisma. */
export async function importSchemaAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  await runAction(`${projectPath(slug)}/versions/new`, async () => {
    const actor = await requirePermission("author-migrations");
    const project = await getProject(actor, slug);
    const format = field(formData, "format");
    let number: number;
    let detail: string;
    if (format === "sql") {
      const result = await importSqlSchema(
        actor,
        project,
        await uploadedText(formData, MAX_SQL_SCRIPT_BYTES),
      );
      number = result.number;
      detail = describeSkipped(result.skipped);
    } else if (format === "prisma") {
      const result = await importPrismaSchema(
        actor,
        project,
        await uploadedText(formData, MAX_PRISMA_SCHEMA_BYTES),
      );
      number = result.number;
      detail =
        result.removed.length === 0
          ? ""
          : ` Removed from the stored file: ${result.removed.join(", ")}.`;
    } else {
      throw new UserFacingError("Choose the file's format.");
    }
    return withFlash(
      `${projectPath(slug)}/versions/${number}`,
      "notice",
      `Imported the schema as version ${number}, the starting point on main. Start a branch for the next change.${detail}`,
    );
  });
}

export async function setSchemaSourceAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  await runAction(`${projectPath(slug)}/settings`, async () => {
    const actor = await requirePermission("manage-projects");
    const project = await getProject(actor, slug);
    const source = parseSchemaSource(field(formData, "schemaSource"));
    await setSchemaSource(actor, project, source);
    return withFlash(
      `${projectPath(slug)}/settings`,
      "notice",
      source === "dashboard"
        ? "The schema is now written in the dashboard: use Edit schema."
        : "The schema is now written in code: branches get their changes from a connected database or an uploaded schema file.",
    );
  });
}
