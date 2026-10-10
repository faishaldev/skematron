// Example: read a PostgreSQL schema with Skematron and print the SQL that recreates it.
// Read-only: introspection runs in a read-only transaction that is always rolled back.
//
//   pnpm example:export [namespace ...]          (default: every user namespace)
//   pnpm -s example:export demo > demo.sql       (save the output)
//
// Connects to DATABASE_URL if set, otherwise to SKEMATRON_TEST_DATABASE_URL from .env
// (the local test database started by `pnpm db:start`). Never prints the URL.
import pg from "pg";
import {
  emptySnapshot,
  planMigration,
  snapshotChecksum,
} from "@skematron/core";
import { introspectPostgres, renderPostgresMigration } from "../src/index.ts";

const url = process.env.DATABASE_URL ?? process.env.SKEMATRON_TEST_DATABASE_URL;
if (url === undefined || url === "") {
  console.error(
    "No database to read. Set DATABASE_URL, or run `pnpm db:start` to start the local test database.",
  );
  process.exit(1);
}

const namespaces = process.argv.slice(2);
const client = new pg.Client({
  connectionString: url,
  application_name: "skematron-example",
});
try {
  await client.connect();
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(
    code === "ENOENT" || code === "ECONNREFUSED"
      ? "Cannot reach the database. For the local test database, run `pnpm db:start` first."
      : `Cannot connect to the database: ${(error as Error).message}`,
  );
  process.exit(1);
}

const comment = (text: string): string => `-- ${text.replace(/[\r\n]+/g, " ")}`;
try {
  const { snapshot, unsupported, serverVersion } = await introspectPostgres(
    client,
    namespaces.length > 0 ? { namespaces } : {},
  );
  console.log(comment(`Read from PostgreSQL ${serverVersion}`));
  console.log(
    comment(`Snapshot checksum: ${await snapshotChecksum(snapshot)}`),
  );
  if (unsupported.length > 0) {
    console.log(comment("Not captured (reported, not exported):"));
    for (const object of unsupported) {
      const where = [object.namespace, object.table, object.name].filter(
        (part) => part !== null,
      );
      console.log(comment(`  ${object.kind} ${where.join(".")}`));
    }
  }
  console.log("");
  const plan = planMigration(emptySnapshot("postgresql"), snapshot);
  process.stdout.write(renderPostgresMigration(plan).script);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
