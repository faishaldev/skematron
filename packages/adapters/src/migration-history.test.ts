import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  column,
  foreignKey,
  namespace,
  sequence,
  snapshot,
  table,
} from "@skematron/core/testing";
import {
  migrationHistoryTool,
  withoutMigrationHistory,
} from "./migration-history.ts";

describe("withoutMigrationHistory", () => {
  it("knows the history tables of common tools, and not generic names", () => {
    assert.equal(migrationHistoryTool("_prisma_migrations"), "Prisma");
    assert.equal(migrationHistoryTool("django_migrations"), "Django");
    assert.equal(migrationHistoryTool("SequelizeMeta"), "Sequelize");
    assert.equal(migrationHistoryTool("sequelizemeta"), null);
    assert.equal(migrationHistoryTool("migrations"), null);
    assert.equal(migrationHistoryTool("users"), null);
  });

  it("removes history tables with the sequences they own, and reports them", () => {
    const users = table("users", { columns: [column("id", "integer")] });
    const input = snapshot(
      namespace("public", {
        tables: [
          users,
          table("knex_migrations", { columns: [column("id", "integer")] }),
          table("alembic_version"),
        ],
        sequences: [
          sequence("knex_migrations_id_seq", {
            ownedBy: { table: "knex_migrations", column: "id" },
          }),
          sequence("users_id_seq", {
            ownedBy: { table: "users", column: "id" },
          }),
        ],
      }),
      namespace("drizzle", { tables: [table("__drizzle_migrations")] }),
    );
    const { snapshot: result, removed } = withoutMigrationHistory(input);
    assert.deepEqual(
      result,
      snapshot(
        namespace("public", {
          tables: [users],
          sequences: [
            sequence("users_id_seq", {
              ownedBy: { table: "users", column: "id" },
            }),
          ],
        }),
      ),
    );
    assert.deepEqual(removed, [
      { namespace: "public", table: "knex_migrations", tool: "Knex" },
      { namespace: "public", table: "alembic_version", tool: "Alembic" },
      { namespace: "drizzle", table: "__drizzle_migrations", tool: "Drizzle" },
    ]);
  });

  it("keeps a history table that takes part in foreign keys", () => {
    const input = snapshot(
      namespace("public", {
        tables: [
          table("schema_migrations"),
          table("audit", {
            foreignKeys: [
              foreignKey("audit_version_fkey", ["version"], {
                namespace: "public",
                table: "schema_migrations",
                columns: ["version"],
              }),
            ],
          }),
        ],
      }),
    );
    assert.deepEqual(withoutMigrationHistory(input), {
      snapshot: input,
      removed: [],
    });
  });
});
