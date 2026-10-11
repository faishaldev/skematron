"use server";

import { field, runAction } from "../../../lib/actions.ts";
import { createProject, parseSchemaSource } from "../../../lib/projects.ts";
import { requirePermission } from "../../../lib/session.ts";

export async function createProjectAction(formData: FormData): Promise<void> {
  await runAction("/projects/new", async () => {
    const actor = await requirePermission("manage-projects");
    const project = await createProject(
      actor,
      field(formData, "name"),
      parseSchemaSource(field(formData, "schemaSource") || "code"),
    );
    return `/projects/${project.slug}`;
  });
}
