import { resolveVersion } from "../../../../../../../lib/version-pages.ts";
import { artifacts } from "../../../../../../../lib/versions.ts";

export const dynamic = "force-dynamic";

/** The version's snapshot exactly as stored (canonical JSON, verified against its checksum). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ project: string; number: string }> },
): Promise<Response> {
  const { project, version } = await resolveVersion(params);
  const bytes = await artifacts().get(version.checksum);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${project.slug}-v${version.number}.json"`,
      "x-skematron-checksum": version.checksum,
    },
  });
}
