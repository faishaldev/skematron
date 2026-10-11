// A migration tool's history table (`_prisma_migrations`, `alembic_version`, …) is the
// tool's bookkeeping, not the application's schema. Every schema read from outside
// Skematron (a database, an uploaded script) leaves those tables out and lists them as
// not tracked, so a database import and a schema file of the same app compare as equal.
// Schemas written in the editor are never filtered: there, every table was asked for.
import type { SchemaSnapshot } from "@skematron/core";
import {
  withoutMigrationHistory,
  type UnsupportedObject,
} from "@skematron/adapters";

export function untrackMigrationHistory<
  T extends { snapshot: SchemaSnapshot; unsupported: UnsupportedObject[] },
>(read: T): T {
  const { snapshot, removed } = withoutMigrationHistory(read.snapshot);
  if (removed.length === 0) return read;
  return {
    ...read,
    snapshot,
    unsupported: [
      ...read.unsupported,
      ...removed.map((table) => ({
        kind: "migration-history",
        namespace: table.namespace,
        table: null,
        name: table.table,
      })),
    ],
  };
}
