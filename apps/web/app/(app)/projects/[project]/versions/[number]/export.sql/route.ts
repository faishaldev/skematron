import { emptySnapshot, planMigration } from "@skematron/core";
import { renderPostgresMigration } from "@skematron/adapters";
import { resolveVersion } from "../../../../../../../lib/version-pages.ts";
import { loadSnapshot } from "../../../../../../../lib/versions.ts";

export const dynamic = "force-dynamic";

/** The SQL that recreates this version from nothing, as a download. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ project: string; number: string }> },
): Promise<Response> {
  const { project, version } = await resolveVersion(params);
  const { script } = renderPostgresMigration(
    planMigration(emptySnapshot("postgresql"), await loadSnapshot(version)),
  );
  return new Response(script, {
    headers: {
      "content-type": "application/sql; charset=utf-8",
      "content-disposition": `attachment; filename="${project.slug}-v${version.number}.sql"`,
    },
  });
}
