// The shadow database: temporary databases on a dedicated, disposable PostgreSQL server
// (SKEMATRON_SHADOW_DATABASE_URL), where Skematron runs SQL from user input to see what it
// really does: uploaded SQL scripts, Prisma's DDL, and migration plans. It is never a
// user's database and never the metadata database. Every run gets a fresh
// skematron_shadow_* database that is dropped afterwards, and the role must not be a
// superuser.
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  emptySnapshot,
  isEmptyPlan,
  planMigration,
  type MigrationPlan,
  type SchemaSnapshot,
} from "@skematron/core";
import {
  introspectPostgres,
  quoteIdent,
  renderPostgresMigration,
  type PostgresIntrospection,
  type PreparedScript,
  type UnsupportedObject,
} from "@skematron/adapters";
import { shadowDatabaseUrl } from "./env.ts";
import { UserFacingError } from "./errors.ts";
import { untrackMigrationHistory } from "./migration-history.ts";

export const SHADOW_PREFIX = "skematron_shadow_";
const STATEMENT_TIMEOUT_MS = 30_000;
const SCRIPT_TIMEOUT_MS = 120_000;

export class ShadowUnavailableError extends UserFacingError {
  constructor(reason: string) {
    super(`The shadow database is not available: ${reason}`);
    this.name = "ShadowUnavailableError";
  }
}

/** PostgreSQL's own message for a failed statement; never contains connection details. */
function postgresMessage(error: unknown): string {
  const { message, code } = error as { message?: string; code?: string };
  if (code !== undefined && message !== undefined) return message;
  return /timeout/i.test(message ?? "")
    ? "it did not finish in time"
    : "the statement failed";
}

function withDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

async function connect(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString,
    application_name: "skematron-shadow",
    connectionTimeoutMillis: 10_000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    lock_timeout: 10_000,
    // Also enforced by the client, in case a script turned the server's limit off.
    query_timeout: STATEMENT_TIMEOUT_MS + 5_000,
  });
  // A dropped connection is reported by the next query; this keeps it from crashing the process.
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unknown error";
    throw new ShadowUnavailableError(`cannot connect (${code}).`);
  }
  return client;
}

/**
 * Creates an empty database on the shadow server, runs `work` in it, and always drops it.
 * `reconnect` opens another connection to the same database, closed afterwards too.
 */
export async function withShadowDatabase<T>(
  work: (client: pg.Client, reconnect: () => Promise<pg.Client>) => Promise<T>,
): Promise<T> {
  const base = shadowDatabaseUrl();
  if (base === null) {
    throw new ShadowUnavailableError(
      "set SKEMATRON_SHADOW_DATABASE_URL (see docs/self-hosting.md).",
    );
  }
  const admin = await connect(base);
  try {
    const { rows } = await admin.query<{ rolsuper: boolean }>(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    if (rows[0]?.rolsuper !== false) {
      throw new ShadowUnavailableError(
        "its role is a superuser. Use a role that can only create databases.",
      );
    }
    const name = `${SHADOW_PREFIX}${randomBytes(8).toString("hex")}`;
    try {
      await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
    } catch (error) {
      throw new ShadowUnavailableError(
        `cannot create a database (${postgresMessage(error)}).`,
      );
    }
    let result: T;
    try {
      const url = withDatabase(base, name);
      const clients = [await connect(url)];
      try {
        result = await work(clients[0]!, async () => {
          const client = await connect(url);
          clients.push(client);
          return client;
        });
      } finally {
        for (const client of clients) await client.end().catch(() => undefined);
      }
    } catch (error) {
      await dropShadowDatabase(admin, name).catch((dropError: unknown) =>
        console.error(dropError),
      );
      throw error;
    }
    await dropShadowDatabase(admin, name);
    return result;
  } finally {
    await admin.end().catch(() => undefined);
  }
}

// A non-superuser's DROP DATABASE ... WITH (FORCE) cannot end another role's session in the
// database, and that includes an autovacuum worker visiting the fresh database ("must be a
// member of the role whose process is being terminated"). Such visits are short, so the
// drop is tried again for a few seconds before giving up.
const DROP_ATTEMPTS = 8;
const RETRYABLE_DROP = new Set(["42501", "55006"]);

async function dropShadowDatabase(admin: pg.Client, name: string) {
  if (!name.startsWith(SHADOW_PREFIX)) {
    throw new Error(`Refusing to drop ${name}: not a shadow database.`);
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      await admin.query(
        `DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`,
      );
      return;
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      if (attempt >= DROP_ATTEMPTS || !RETRYABLE_DROP.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

/** Every new database has a `public` schema; ignore it when nothing uses it. */
function withoutEmptyPublic(snapshot: SchemaSnapshot): SchemaSnapshot {
  return {
    ...snapshot,
    namespaces: snapshot.namespaces.filter(
      (namespace) =>
        namespace.name !== "public" ||
        namespace.tables.length > 0 ||
        namespace.enums.length > 0 ||
        namespace.sequences.length > 0,
    ),
  };
}

/** The start of a statement, for error messages. */
function excerpt(sql: string): string {
  const first = sql.split("\n", 1)[0]!.trim();
  return first.length > 120 || sql.includes("\n")
    ? `${first.slice(0, 120)}…`
    : first;
}

/**
 * Runs a script in a fresh shadow database, one statement at a time, and reads back the
 * schema it built. With `base`, that version is recreated first and the script applies
 * its changes on top (a migration). The schema is read over a new connection, as after
 * psql exits: a transaction the script left open is rolled back, and its session
 * settings are gone. Migration tools' history tables are listed as not tracked.
 */
export function snapshotFromScript(input: {
  script: PreparedScript;
  base?: {
    label: string;
    snapshot: SchemaSnapshot;
    unsupported: readonly UnsupportedObject[];
  };
}): Promise<PostgresIntrospection> {
  return withShadowDatabase(async (client, reconnect) => {
    if (input.base !== undefined) {
      const failure = await recreate(
        client,
        input.base.snapshot,
        input.base.unsupported,
      );
      if (failure !== null) {
        throw new UserFacingError(
          `Could not recreate ${input.base.label} in the shadow database. ${failure}`,
        );
      }
    }
    const { statements } = input.script;
    const deadline = Date.now() + SCRIPT_TIMEOUT_MS;
    for (const [index, statement] of statements.entries()) {
      if (Date.now() > deadline) {
        throw new UserFacingError(
          `The script did not finish within ${SCRIPT_TIMEOUT_MS / 1000} seconds.`,
        );
      }
      try {
        await client.query(statement.sql);
      } catch (error) {
        throw new UserFacingError(
          `Statement ${index + 1} of ${statements.length} (line ${statement.line}, ${excerpt(statement.sql)}) failed in the shadow database: ${postgresMessage(error)}`,
        );
      }
    }
    await client.end();
    const result = await introspectPostgres(await reconnect());
    return untrackMigrationHistory({
      ...result,
      snapshot: withoutEmptyPublic(result.snapshot),
    });
  });
}

export type Verification =
  { status: "passed" } | { status: "failed" | "unavailable"; detail: string };

async function runEach(
  client: pg.Client,
  statements: readonly { sql: string }[],
): Promise<{ index: number; message: string } | null> {
  for (const [index, statement] of statements.entries()) {
    try {
      await client.query(statement.sql);
    } catch (error) {
      return { index, message: postgresMessage(error) };
    }
  }
  return null;
}

/**
 * Recreates a snapshot in the shadow database: first the extensions it reported, then the
 * DDL that builds it from nothing. Returns a message on the first failure, or null.
 */
async function recreate(
  client: pg.Client,
  snapshot: SchemaSnapshot,
  unsupported: readonly UnsupportedObject[],
): Promise<string | null> {
  for (const extension of unsupported) {
    if (extension.kind !== "extension") continue;
    const failed = await runEach(client, [
      { sql: `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(extension.namespace)}` },
      {
        sql: `CREATE EXTENSION IF NOT EXISTS ${quoteIdent(extension.name)} SCHEMA ${quoteIdent(extension.namespace)}`,
      },
    ]);
    if (failed !== null) {
      return `Could not create extension ${extension.name}: ${failed.message}`;
    }
  }
  const { statements } = renderPostgresMigration(
    planMigration(emptySnapshot(snapshot.dialect), snapshot),
  );
  const failure = await runEach(client, statements);
  return failure === null
    ? null
    : `Statement ${failure.index + 1} of ${statements.length} failed: ${failure.message}`;
}

/**
 * Builds a snapshot in a fresh shadow database and reads it back, so types, defaults and
 * index definitions are stored the way PostgreSQL prints them (`int` becomes `integer`).
 * Used for schemas edited in the dashboard, which contain fragments people typed.
 */
export function normalizeSnapshot(
  snapshot: SchemaSnapshot,
  unsupported: readonly UnsupportedObject[],
): Promise<PostgresIntrospection> {
  return withShadowDatabase(async (client) => {
    const failure = await recreate(client, snapshot, unsupported);
    if (failure !== null) {
      throw new UserFacingError(`PostgreSQL rejected the schema. ${failure}`);
    }
    return introspectPostgres(client, {
      namespaces: snapshot.namespaces.map((namespace) => namespace.name),
    });
  });
}

/**
 * Checks a plan for real: recreates `from` in a fresh shadow database (with the
 * extensions it uses), applies the plan one statement at a time, and requires
 * the result to be equivalent to `to`.
 */
export async function verifyMigration(input: {
  from: SchemaSnapshot;
  /** What introspection reported for `from` but did not capture; extensions are recreated. */
  fromUnsupported: readonly UnsupportedObject[];
  plan: MigrationPlan;
  to: SchemaSnapshot;
}): Promise<Verification> {
  const fail = (detail: string): Verification => ({ status: "failed", detail });
  try {
    return await withShadowDatabase(async (client) => {
      const setupFailure = await recreate(
        client,
        input.from,
        input.fromUnsupported,
      );
      if (setupFailure !== null) {
        return fail(
          `Could not recreate the starting version in the shadow database. ${setupFailure}`,
        );
      }
      const { statements } = renderPostgresMigration(input.plan);
      const failure = await runEach(client, statements);
      if (failure !== null) {
        return fail(
          `Statement ${failure.index + 1} of ${statements.length} failed: ${failure.message}`,
        );
      }
      const { snapshot } = await introspectPostgres(client);
      const result = input.to.namespaces.some(
        (namespace) => namespace.name === "public",
      )
        ? snapshot
        : withoutEmptyPublic(snapshot);
      const remaining = planMigration(result, input.to);
      if (!isEmptyPlan(remaining)) {
        const count =
          remaining.operations.length + remaining.unsupported.length;
        return fail(
          `The plan ran, but the result still differs from the target version (${count} ${count === 1 ? "difference" : "differences"}).`,
        );
      }
      return { status: "passed" };
    });
  } catch (error) {
    if (error instanceof ShadowUnavailableError) {
      return { status: "unavailable", detail: error.message };
    }
    throw error;
  }
}
