// Server-only wiring: database access and the snapshot store.
// The connection URL never leaves this module; pages only see `source`.
import "server-only";
import { resolve } from "node:path";
import pg from "pg";
import {
  introspectPostgres,
  type PostgresIntrospection,
} from "@skematron/adapters";
import { createSnapshotStore, type SnapshotStore } from "./snapshots.ts";

export class DatabaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

export type DatabaseSource = "DATABASE_URL" | "test database (.env)";

export interface DatabaseRead extends PostgresIntrospection {
  source: DatabaseSource;
}

function target(): { url: string; source: DatabaseSource } | null {
  const custom = process.env.DATABASE_URL;
  if (custom) return { url: custom, source: "DATABASE_URL" };
  const test = process.env.SKEMATRON_TEST_DATABASE_URL;
  if (test) return { url: test, source: "test database (.env)" };
  return null;
}

/** Reads the schema read-only (see introspectPostgres). Never writes to the database. */
export async function readDatabase(
  namespaces?: readonly string[],
): Promise<DatabaseRead> {
  const database = target();
  if (database === null) {
    throw new DatabaseUnavailableError(
      "No database configured. Run `pnpm db:test:start`, or set DATABASE_URL before starting the viewer.",
    );
  }
  const client = new pg.Client({
    connectionString: database.url,
    application_name: "skematron-web",
  });
  try {
    await client.connect();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new DatabaseUnavailableError(
      code === "ENOENT" || code === "ECONNREFUSED"
        ? `Cannot reach the ${database.source}. If it is the local test database, run \`pnpm db:test:start\`.`
        : `Cannot connect to the ${database.source}: ${(error as Error).message}`,
    );
  }
  try {
    const result = await introspectPostgres(
      client,
      namespaces === undefined ? {} : { namespaces },
    );
    return { ...result, source: database.source };
  } finally {
    await client.end();
  }
}

/** `SKEMATRON_SNAPSHOT_DIR`, or `.local/snapshots` in the repository (git-ignored). */
export function snapshotStore(): SnapshotStore {
  return createSnapshotStore(
    process.env.SKEMATRON_SNAPSHOT_DIR ??
      resolve(process.cwd(), "../../.local/snapshots"),
  );
}
