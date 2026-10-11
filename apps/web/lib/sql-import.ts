// SQL import: the way in for any ORM or migration tool, since all of them can produce
// PostgreSQL SQL. A script is either
// - the whole schema: pg_dump --schema-only, Rails' structure.sql, drizzle-kit export,
//   alembic upgrade head --sql. It runs in an empty shadow database.
// - or changes only: one or more migrations, such as Django's sqlmigrate or a Prisma
//   migration.sql. They run on top of the version they start from, recreated first.
// Introspecting the shadow database afterwards gives the snapshot, so the result is what
// PostgreSQL really built.
//
// The script itself is not stored, only its checksum: it may hold rows (INSERTs), and the
// version's snapshot and SQL export already give the schema back.
import { createHash } from "node:crypto";
import type { SchemaSnapshot } from "@skematron/core";
import {
  preparePostgresScript,
  SqlScriptError,
  type SkippedStatement,
  type UnsupportedObject,
} from "@skematron/adapters";
import type { Actor } from "./actor.ts";
import { UserFacingError } from "./errors.ts";
import { assertCan, requireSchemaSource, type Project } from "./projects.ts";
import { snapshotFromScript } from "./shadow.ts";
import { listVersions, recordVersion, type ImportResult } from "./versions.ts";

export const MAX_SQL_SCRIPT_BYTES = 1024 * 1024;

export type SqlScriptKind = "schema" | "changes";

export function parseSqlScriptKind(value: string): SqlScriptKind {
  if (value !== "schema" && value !== "changes") {
    throw new UserFacingError(
      "Choose whether the SQL is the whole schema or only changes.",
    );
  }
  return value;
}

export interface SqlImport {
  snapshot: SchemaSnapshot;
  unsupported: UnsupportedObject[];
  skipped: SkippedStatement[];
  source: Record<string, string>;
}

/**
 * Runs a SQL script in the shadow database and returns the schema it builds. For
 * "changes", `base` is the version the script starts from.
 */
export async function sqlSnapshot(
  text: string,
  kind: SqlScriptKind,
  base?: {
    number: number | null;
    snapshot: SchemaSnapshot;
    unsupported: readonly UnsupportedObject[];
  },
): Promise<SqlImport> {
  if (text.trim() === "") {
    throw new UserFacingError("Upload or paste a SQL file.");
  }
  if (Buffer.byteLength(text) > MAX_SQL_SCRIPT_BYTES) {
    throw new UserFacingError(
      `The SQL is larger than ${MAX_SQL_SCRIPT_BYTES / 1024 / 1024} MB.`,
    );
  }
  let script;
  try {
    script = preparePostgresScript(text);
  } catch (error) {
    if (!(error instanceof SqlScriptError)) throw error;
    throw new UserFacingError(`The SQL cannot be used. ${error.message}`);
  }
  if (script.statements.length === 0) {
    throw new UserFacingError("The file has no SQL statements to run.");
  }
  const on = kind === "changes" ? base : undefined;
  const { snapshot, unsupported } = await snapshotFromScript({
    script,
    base:
      on === undefined
        ? undefined
        : {
            label: on.number === null ? "the empty schema" : `v${on.number}`,
            snapshot: on.snapshot,
            unsupported: on.unsupported,
          },
  });
  return {
    snapshot,
    unsupported,
    skipped: script.skipped,
    source: {
      kind: "sql-script",
      script: kind,
      scriptChecksum: `sha256:${createHash("sha256").update(text).digest("hex")}`,
      ...(on?.number != null ? { onVersion: String(on.number) } : {}),
    },
  };
}

/** "Skipped 17 statements: ownership, privileges." for a notice, or "". */
export function describeSkipped(skipped: readonly SkippedStatement[]): string {
  if (skipped.length === 0) return "";
  const reasons = [...new Set(skipped.map((statement) => statement.reason))];
  return ` Skipped ${skipped.length} ${skipped.length === 1 ? "statement" : "statements"} that do not change the schema: ${reasons.join(", ")}.`;
}

/**
 * Records a SQL script with the whole schema as the first version on main (the baseline).
 * Later changes go through a branch: see uploadSqlToBranch in lib/branches.ts.
 */
export async function importSqlSchema(
  actor: Actor,
  project: Project,
  text: string,
): Promise<ImportResult & { skipped: SkippedStatement[] }> {
  assertCan(actor, "author-migrations");
  requireSchemaSource(project, "code");
  if ((await listVersions(actor, project)).length > 0) {
    throw new UserFacingError(
      "Main already has a version. Start a branch and upload the changed schema there, so the change is reviewed.",
    );
  }
  const imported = await sqlSnapshot(text, "schema");
  const result = await recordVersion(actor, project, {
    snapshot: imported.snapshot,
    unsupported: imported.unsupported,
    source: imported.source,
    basedOn: { versionId: null },
  });
  return { ...result, skipped: imported.skipped };
}
