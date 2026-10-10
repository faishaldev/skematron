// Shared lookups for version pages and routes: resolve project and version from URL params
// for the signed-in actor, turning "not found" into a 404.
import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "./errors.ts";
import { getProject } from "./projects.ts";
import { requireActor } from "./session.ts";
import { getVersion } from "./versions.ts";

export async function resolveVersion(
  params: Promise<{ project: string; number: string }>,
) {
  const actor = await requireActor();
  const { project: slug, number } = await params;
  try {
    const project = await getProject(actor, slug);
    const version = await getVersion(
      actor,
      project,
      /^\d{1,9}$/.test(number) ? Number(number) : Number.NaN,
    );
    return { actor, project, version };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
