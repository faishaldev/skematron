// Tables that migration tools keep for themselves, to remember which migrations ran. They
// are the tool's bookkeeping, not the application's schema: a schema file or an ORM's SQL
// export never contains them, while a database or a dump always does. Leaving them out of
// snapshots keeps every source comparable, so switching from a database import to an
// uploaded schema never shows them as deleted.
//
// Only names no application would choose are listed. Generic names (Laravel's and
// TypeORM's `migrations`) stay tracked like any other table.
import type { SchemaSnapshot } from "@skematron/core";

export const MIGRATION_HISTORY_TABLES: ReadonlyMap<string, string> = new Map([
  ["_prisma_migrations", "Prisma"],
  ["__drizzle_migrations", "Drizzle"],
  ["alembic_version", "Alembic"],
  ["django_migrations", "Django"],
  ["schema_migrations", "Rails, golang-migrate or dbmate"],
  ["ar_internal_metadata", "Rails"],
  ["knex_migrations", "Knex"],
  ["knex_migrations_lock", "Knex"],
  ["kysely_migration", "Kysely"],
  ["kysely_migration_lock", "Kysely"],
  ["SequelizeMeta", "Sequelize"],
  ["mikro_orm_migrations", "MikroORM"],
  ["pgmigrations", "node-pg-migrate"],
  ["flyway_schema_history", "Flyway"],
  ["databasechangelog", "Liquibase"],
  ["databasechangeloglock", "Liquibase"],
  ["goose_db_version", "goose"],
  ["_sqlx_migrations", "SQLx"],
  ["__EFMigrationsHistory", "Entity Framework Core"],
]);

/** The tool that keeps a table of this name, or null for an ordinary table. */
export function migrationHistoryTool(table: string): string | null {
  return MIGRATION_HISTORY_TABLES.get(table) ?? null;
}

export interface MigrationHistoryTable {
  namespace: string;
  table: string;
  tool: string;
}

/**
 * Removes migration history tables (and the sequences their columns own) from a snapshot.
 * A table that a foreign key points at, or that has foreign keys itself, is kept: then it
 * is part of the application after all. A namespace left empty by the removal goes too.
 */
export function withoutMigrationHistory(snapshot: SchemaSnapshot): {
  snapshot: SchemaSnapshot;
  removed: MigrationHistoryTable[];
} {
  const referenced = new Set<string>();
  for (const namespace of snapshot.namespaces) {
    for (const table of namespace.tables) {
      for (const foreignKey of table.foreignKeys) {
        referenced.add(
          JSON.stringify([
            foreignKey.references.namespace,
            foreignKey.references.table,
          ]),
        );
      }
    }
  }
  const removed: MigrationHistoryTable[] = [];
  const namespaces = snapshot.namespaces.flatMap((namespace) => {
    const dropped = new Set<string>();
    for (const table of namespace.tables) {
      const tool = migrationHistoryTool(table.name);
      if (
        tool !== null &&
        table.foreignKeys.length === 0 &&
        !referenced.has(JSON.stringify([namespace.name, table.name]))
      ) {
        dropped.add(table.name);
        removed.push({ namespace: namespace.name, table: table.name, tool });
      }
    }
    if (dropped.size === 0) return [namespace];
    const kept = {
      ...namespace,
      tables: namespace.tables.filter((table) => !dropped.has(table.name)),
      sequences: namespace.sequences.filter(
        (sequence) =>
          sequence.ownedBy === null || !dropped.has(sequence.ownedBy.table),
      ),
    };
    const empty =
      kept.tables.length === 0 &&
      kept.enums.length === 0 &&
      kept.sequences.length === 0;
    return empty ? [] : [kept];
  });
  return { snapshot: { ...snapshot, namespaces }, removed };
}
