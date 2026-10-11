import { notFound } from "next/navigation";
import { resolveVersion } from "../../../../../../../lib/version-pages.ts";
import { artifacts } from "../../../../../../../lib/versions.ts";

export const dynamic = "force-dynamic";

/** The schema.prisma a version was imported from (connection URLs removed), as a download. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ project: string; number: string }> },
): Promise<Response> {
  const { project, version } = await resolveVersion(params);
  const source = version.source as { kind?: string; schemaChecksum?: string };
  if (source.kind !== "prisma-schema" || source.schemaChecksum === undefined) {
    notFound();
  }
  const text = new TextDecoder().decode(
    await artifacts().get(source.schemaChecksum),
  );
  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${project.slug}-v${version.number}.prisma"`,
      "x-skematron-checksum": source.schemaChecksum,
    },
  });
}
