import { emptySnapshot, planMigration } from "@skematron/core";
import { renderPostgresMigration } from "@skematron/adapters";
import { readDatabase } from "../../../lib/server.ts";

export const dynamic = "force-dynamic";

/** GET /export/sql?ns=<schema>: the export script as a .sql download. */
export async function GET(request: Request): Promise<Response> {
  const name = new URL(request.url).searchParams.get("ns");
  if (name === null || name === "") {
    return new Response("Missing ?ns=<schema>.\n", { status: 400 });
  }
  try {
    const { snapshot } = await readDatabase([name]);
    const { script } = renderPostgresMigration(
      planMigration(emptySnapshot("postgresql"), snapshot),
    );
    const filename = `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.sql`;
    return new Response(script, {
      headers: {
        "content-type": "application/sql; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return new Response(`${(error as Error).message}\n`, { status: 502 });
  }
}
