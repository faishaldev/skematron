import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SnapshotValidationError, snapshotChecksum } from "./canonical.ts";
import {
  addColumn,
  addForeignKey,
  addIndex,
  addTable,
  addUniqueConstraint,
  SchemaEditError,
} from "./edit.ts";
import { planMigration } from "./plan.ts";
import { emptySnapshot } from "./snapshot.ts";
import { column, foreignKey, namespace, snapshot, table } from "./testing.ts";

const users = () =>
  snapshot(
    namespace("app", {
      tables: [
        table("users", {
          columns: [column("id", "bigint", { nullable: false })],
          primaryKey: {
            name: "users_pkey",
            columns: ["id"],
            deferrable: "not-deferrable",
          },
        }),
      ],
    }),
  );

const kinds = (from: ReturnType<typeof users>, to: ReturnType<typeof users>) =>
  planMigration(from, to).operations.map(({ operation }) => operation.kind);

describe("schema editing", () => {
  it("adds a table, creating its namespace when needed, without changing the input", async () => {
    const before = emptySnapshot("postgresql");
    const after = addTable(
      before,
      "billing",
      table("invoices", {
        columns: [
          column("id", "bigint", { nullable: false, identity: "by-default" }),
        ],
      }),
    );
    assert.deepEqual(before.namespaces, []);
    assert.deepEqual(
      after.namespaces.map((ns) => ns.name),
      ["billing"],
    );
    assert.deepEqual(kinds(before, after), [
      "create-namespace",
      "create-table",
    ]);
    assert.notEqual(
      await snapshotChecksum(after),
      await snapshotChecksum(before),
    );
  });

  it("adds columns, unique constraints, indexes and foreign keys to existing tables", () => {
    let edited = addTable(
      users(),
      "app",
      table("posts", {
        columns: [column("id", "bigint", { nullable: false })],
      }),
    );
    edited = addColumn(
      edited,
      "app",
      "posts",
      column("author_id", "bigint", { nullable: false }),
    );
    edited = addColumn(
      edited,
      "app",
      "users",
      column("email", "text", { nullable: false }),
    );
    edited = addUniqueConstraint(edited, "app", "users", {
      name: "users_email_key",
      columns: ["email"],
      nullsNotDistinct: false,
      deferrable: "not-deferrable",
    });
    edited = addIndex(edited, "app", "posts", {
      name: "posts_author_id_idx",
      unique: false,
      definition:
        'CREATE INDEX "posts_author_id_idx" ON "app"."posts" USING btree ("author_id")',
    });
    edited = addForeignKey(
      edited,
      "app",
      "posts",
      foreignKey("posts_author_id_fkey", ["author_id"], {
        namespace: "app",
        table: "users",
        columns: ["id"],
      }),
    );
    assert.deepEqual(kinds(users(), edited), [
      "create-table",
      "add-column",
      "create-index",
      "add-unique",
      "add-foreign-key",
    ]);
  });

  it("rejects duplicates, unknown tables and columns, and blank names", () => {
    assert.throws(
      () =>
        addTable(
          users(),
          "app",
          table("users", { columns: [column("x", "text")] }),
        ),
      /already exists/,
    );
    assert.throws(
      () => addTable(users(), "app", table("empty")),
      /at least one column/,
    );
    assert.throws(
      () =>
        addTable(
          users(),
          "app",
          table(" spaced", { columns: [column("x", "text")] }),
        ),
      SchemaEditError,
    );
    assert.throws(
      () => addColumn(users(), "app", "users", column("id", "text")),
      /already exists/,
    );
    assert.throws(
      () => addColumn(users(), "app", "nope", column("x", "text")),
      /does not exist/,
    );
    assert.throws(
      () => addColumn(users(), "app", "users", column("", "text")),
      SchemaEditError,
    );
    assert.throws(
      () =>
        addUniqueConstraint(users(), "app", "users", {
          name: "users_pkey",
          columns: ["id"],
          nullsNotDistinct: false,
          deferrable: "not-deferrable",
        }),
      SnapshotValidationError,
    );
    assert.throws(
      () =>
        addUniqueConstraint(users(), "app", "users", {
          name: "users_x_key",
          columns: ["x"],
          nullsNotDistinct: false,
          deferrable: "not-deferrable",
        }),
      /unknown column/,
    );
    assert.throws(
      () =>
        addForeignKey(
          users(),
          "app",
          "users",
          foreignKey("f", ["id"], {
            namespace: "app",
            table: "ghosts",
            columns: ["id"],
          }),
        ),
      /does not exist/,
    );
    assert.throws(
      () =>
        addForeignKey(
          users(),
          "app",
          "users",
          foreignKey("f", ["id"], {
            namespace: "app",
            table: "users",
            columns: ["uuid"],
          }),
        ),
      /has no column uuid/,
    );
  });
});
