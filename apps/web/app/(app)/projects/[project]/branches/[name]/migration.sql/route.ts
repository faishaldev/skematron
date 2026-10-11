import { notFound } from "next/navigation";
import {
  getBranch,
  testedRevision,
} from "../../../../../../../lib/branches.ts";
import { NotFoundError } from "../../../../../../../lib/errors.ts";
import {
  latestRevision,
  loadRevision,
} from "../../../../../../../lib/migrations.ts";
import { getProject } from "../../../../../../../lib/projects.ts";
import { requireActor } from "../../../../../../../lib/session.ts";

export const dynamic = "force-dynamic";

/** The SQL script of the branch's latest test run, as a download. Skematron does not run it. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ project: string; name: string }> },
): Promise<Response> {
  const actor = await requireActor();
  const { project: slug, name } = await params;
  try {
    const project = await getProject(actor, slug);
    const branch = await getBranch(actor, project, name);
    const revision =
      branch.status === "open"
        ? testedRevision(branch)
        : latestRevision(branch.migration);
    if (revision === null) notFound();
    const { script } = await loadRevision(revision);
    return new Response(script, {
      headers: {
        "content-type": "application/sql; charset=utf-8",
        "content-disposition": `attachment; filename="${project.slug}-${branch.name}-r${revision.number}.sql"`,
        "x-skematron-checksum": revision.scriptChecksum,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
