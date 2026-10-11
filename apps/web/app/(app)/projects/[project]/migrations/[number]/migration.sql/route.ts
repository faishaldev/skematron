import { notFound } from "next/navigation";
import { NotFoundError } from "../../../../../../../lib/errors.ts";
import {
  getMigration,
  latestRevision,
  loadRevision,
} from "../../../../../../../lib/migrations.ts";
import { getProject } from "../../../../../../../lib/projects.ts";
import { requireActor } from "../../../../../../../lib/session.ts";

export const dynamic = "force-dynamic";

/** The latest revision's reviewed SQL script, as a download. Skematron does not run it. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ project: string; number: string }> },
): Promise<Response> {
  const actor = await requireActor();
  const { project: slug, number } = await params;
  try {
    const project = await getProject(actor, slug);
    const migration = await getMigration(
      actor,
      project,
      /^\d{1,9}$/.test(number) ? Number(number) : Number.NaN,
    );
    const revision = latestRevision(migration);
    const { script } = await loadRevision(revision);
    return new Response(script, {
      headers: {
        "content-type": "application/sql; charset=utf-8",
        "content-disposition": `attachment; filename="${project.slug}-M${migration.number}-r${revision.number}.sql"`,
        "x-skematron-checksum": revision.scriptChecksum,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
