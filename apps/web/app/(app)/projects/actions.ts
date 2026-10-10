"use server";

import { field, runAction } from "../../../lib/actions.ts";
import { createProject } from "../../../lib/projects.ts";
import { requirePermission } from "../../../lib/session.ts";

export async function createProjectAction(formData: FormData): Promise<void> {
  await runAction("/projects", async () => {
    const actor = await requirePermission("manage-projects");
    const project = await createProject(actor, field(formData, "name"));
    return `/projects/${project.slug}`;
  });
}
