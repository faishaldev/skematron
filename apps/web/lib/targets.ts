// Connecting to user databases (environments). Read-only: only introspection runs.
// The decrypted URL never leaves this module and never appears in errors or logs.
import pg from "pg";
import {
  introspectPostgres,
  type PostgresIntrospection,
} from "@skematron/adapters";
import { secretKey } from "./env.ts";
import { UserFacingError } from "./errors.ts";
import { untrackMigrationHistory } from "./migration-history.ts";
import { decryptSecret } from "./secrets.ts";

interface Target {
  name: string;
  connectionCiphertext: string;
  namespaces: string[];
}

function describeConnectionError(target: Target, error: unknown): string {
  const code = (error as { code?: string }).code;
  const reason =
    code === "ENOENT" || code === "ECONNREFUSED"
      ? "nothing is listening at that address"
      : code === "ENOTFOUND"
        ? "the host name was not found"
        : code === "ETIMEDOUT" ||
            /timeout/i.test((error as Error).message ?? "")
          ? "the connection timed out"
          : code === "28P01" || code === "28000"
            ? "authentication failed"
            : code === "3D000"
              ? "the database does not exist"
              : `connection failed (${code ?? "unknown error"})`;
  return `Cannot connect to the ${target.name} database: ${reason}.`;
}

async function withTarget<T>(
  target: Target,
  run: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({
    connectionString: decryptSecret(target.connectionCiphertext, secretKey()),
    application_name: "skematron",
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
  } catch (error) {
    throw new UserFacingError(describeConnectionError(target, error));
  }
  try {
    return await run(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Reads the tracked schemas of an environment (read-only introspection). Migration tools'
 * history tables are listed as not tracked.
 */
export function readLive(target: Target): Promise<PostgresIntrospection> {
  return withTarget(target, async (client) =>
    untrackMigrationHistory(
      await introspectPostgres(client, { namespaces: target.namespaces }),
    ),
  );
}
