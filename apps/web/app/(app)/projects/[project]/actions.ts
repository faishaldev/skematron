"use server";

import { field, runAction, withFlash } from "../../../../lib/actions.ts";
import {
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  getProject,
  updateEnvironment,
  type EnvironmentInput,
} from "../../../../lib/projects.ts";
import { requirePermission } from "../../../../lib/session.ts";
import { readLive } from "../../../../lib/targets.ts";
import { importVersion } from "../../../../lib/versions.ts";

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
    const result = await importVersion(actor, project, environment);
    return result.status === "created"
      ? withFlash(
          `${projectPath(slug)}/versions/${result.number}`,
          "notice",
          `Imported version ${result.number} from ${name}.`,
        )
      : withFlash(
          back,
          "notice",
          `No changes: ${name} still matches version ${result.number}, so no new version was created.`,
        );
  });
}
