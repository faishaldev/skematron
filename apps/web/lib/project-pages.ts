// Shared lookup for project pages: the signed-in actor and the project from the URL,
// turning "not found" into a 404.
import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "./errors.ts";
import { getProject } from "./projects.ts";
import { requireActor } from "./session.ts";

export async function resolveProject(params: Promise<{ project: string }>) {
  const actor = await requireActor();
  const { project: slug } = await params;
  try {
    return { actor, project: await getProject(actor, slug) };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
