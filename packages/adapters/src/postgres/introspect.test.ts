import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  introspectPostgres,
  PostgresIntrospectionError,
} from "./introspect.ts";
import type { PostgresSession } from "./session.ts";

type Row = Record<string, unknown>;

/** Answers each catalog query by its `skematron:<name>` marker and records every statement. */
function fakeSession(responses: Record<string, Row[]>, failOn?: string) {
  const queries: string[] = [];
  const session: PostgresSession = {
    async query(text) {
      queries.push(text);
      const name = /skematron:([\w-]+)/.exec(text)?.[1];
      if (name !== undefined && name === failOn)
        throw new Error(`simulated failure in ${name}`);
      return { rows: name === undefined ? [] : (responses[name] ?? []) };
    },
  };
  return { session, queries };
}

const VERSION_14 = [{ version_num: 140020, version: "14.20" }];

const relation = (name: string, overrides: Row = {}): Row => ({
  namespace: "app",
  name,
  kind: "r",
  persistence: "p",
  is_partition: false,
  row_security: false,
  inherits: false,
  comment: null,
  ...overrides,
});

const columnRow = (
  table: string,
  name: string,
  position: number,
  overrides: Row = {},
): Row => ({
  namespace: "app",
  table_name: table,
  name,
  position,
  type: "integer",
  not_null: false,
  identity: "",
  generated: "",
  default_expression: null,
  collation: null,
  comment: null,
  ...overrides,
});

const constraintRow = (
  name: string,
  type: string,
  overrides: Row = {},
): Row => ({
  namespace: "app",
  table_name: "users",
  name,
  type,
  columns: null,
  ref_namespace: null,
  ref_table: null,
  ref_columns: null,
  on_update: " ",
  on_delete: " ",
  match_type: " ",
  deferrable: false,
  deferred: false,
  check_expression: null,
  no_inherit: false,
  nulls_not_distinct: false,
  has_delete_set_columns: false,
  ...overrides,
});

function catalog(): Record<string, Row[]> {
  return {
    version: VERSION_14,
    namespaces: [{ name: "app" }, { name: "other" }],
    relations: [
      relation("users", { row_security: true, comment: "People" }),
      relation("user_names", { kind: "v" }),
      relation("events", { kind: "p" }),
      relation("events_2026", { is_partition: true, inherits: true }),
      relation("scratch", { persistence: "u" }),
      relation("elsewhere", { namespace: "other" }),
    ],
    columns: [
      columnRow("users", "email", 2, {
        type: "text",
        not_null: true,
        collation: 'pg_catalog."C"',
        comment: "Login",
      }),
      columnRow("users", "id", 1, {
        type: "bigint",
        not_null: true,
        identity: "d",
      }),
      columnRow("users", "email_lower", 4, {
        type: "text",
        generated: "s",
        default_expression: "lower(email)",
      }),
      columnRow("users", "parent_id", 3, {
        type: "bigint",
        default_expression: "NULL::bigint",
      }),
      columnRow("user_names", "name", 1, { type: "text" }),
      columnRow("elsewhere", "id", 1, { namespace: "other" }),
    ],
    constraints: [
      constraintRow("users_pkey", "p", { columns: '["id"]' }),
      constraintRow("users_email_key", "u", {
        columns: '["email"]',
        deferrable: true,
      }),
      constraintRow("users_email_check", "c", {
        columns: '["email"]',
        check_expression: "(email <> ''::text)",
      }),
      constraintRow("users_parent_fkey", "f", {
        columns: '["parent_id"]',
        ref_namespace: "app",
        ref_table: "users",
        ref_columns: '["id"]',
        on_update: "a",
        on_delete: "n",
        match_type: "s",
        deferrable: true,
        deferred: true,
      }),
      constraintRow("users_no_overlap", "x"),
      constraintRow("users_id_not_null", "n", { columns: '["id"]' }),
      constraintRow("users_legacy_check", "c", {
        check_expression: "true",
        no_inherit: true,
      }),
    ],
    indexes: [
      {
        namespace: "app",
        table_name: "users",
        name: "users_lower_email_idx",
        is_unique: true,
        is_valid: true,
        definition:
          "CREATE UNIQUE INDEX users_lower_email_idx ON app.users USING btree (lower(email))",
      },
      {
        namespace: "app",
        table_name: "users",
        name: "users_broken_idx",
        is_unique: false,
        is_valid: false,
        definition:
          "CREATE INDEX users_broken_idx ON app.users USING btree (email)",
      },
    ],
    enums: [{ namespace: "app", name: "mood", labels: '["sad","happy"]' }],
    sequences: [
      {
        namespace: "app",
        name: "users_id_seq",
        data_type: "bigint",
        start: "1",
        increment: "1",
        min_value: "1",
        max_value: "9223372036854775807",
        cache: "1",
        cycle: false,
        owner_dependency: "i",
        owner_table: "users",
        owner_column: "id",
      },
      {
        namespace: "app",
        name: "counter",
        data_type: "integer",
        start: "10",
        increment: "2",
        min_value: "1",
        max_value: "2147483647",
        cache: "1",
        cycle: true,
        owner_dependency: null,
        owner_table: null,
        owner_column: null,
      },
      {
        namespace: "app",
        name: "events_id_seq",
        data_type: "integer",
        start: "1",
        increment: "1",
        min_value: "1",
        max_value: "2147483647",
        cache: "1",
        cycle: false,
        owner_dependency: "a",
        owner_table: "events",
        owner_column: "id",
      },
    ],
    "other-objects": [
      {
        kind: "trigger",
        namespace: "app",
        table_name: "users",
        name: "users_touch",
      },
      { kind: "function", namespace: "app", table_name: null, name: "touch()" },
      {
        kind: "view",
        namespace: "other",
        table_name: null,
        name: "not_in_scope",
      },
    ],
  };
}

describe("introspectPostgres", () => {
  it("runs inside a read-only transaction that is always rolled back", async () => {
    const { session, queries } = fakeSession(catalog());
    await introspectPostgres(session, { namespaces: ["app"] });
    assert.equal(queries[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.match(queries[1]!, /skematron:settings/);
    assert.match(queries[1]!, /set_config\('search_path', '', true\)/);
    assert.equal(queries.at(-1), "ROLLBACK");
    for (const query of queries.slice(1, -1))
      assert.match(query, /^\/\* skematron:/);
  });

  it("rolls back and keeps the original error when a query fails", async () => {
    const { session, queries } = fakeSession(catalog(), "columns");
    await assert.rejects(
      introspectPostgres(session),
      /simulated failure in columns/,
    );
    assert.equal(queries.at(-1), "ROLLBACK");
  });

  it("rejects servers older than PostgreSQL 14", async () => {
    const { session, queries } = fakeSession({
      version: [{ version_num: 130012, version: "13.12" }],
    });
    await assert.rejects(
      introspectPostgres(session),
      PostgresIntrospectionError,
    );
    assert.equal(queries.at(-1), "ROLLBACK");
  });

  it("rejects a namespace that does not exist", async () => {
    const { session } = fakeSession(catalog());
    await assert.rejects(
      introspectPostgres(session, { namespaces: ["missing"] }),
      /missing/,
    );
  });

  it("rejects an invalid timeout before opening a transaction", async () => {
    const { session, queries } = fakeSession(catalog());
    await assert.rejects(
      introspectPostgres(session, { statementTimeoutMs: 0 }),
      RangeError,
    );
    await assert.rejects(
      introspectPostgres(session, { statementTimeoutMs: 1.5 }),
      RangeError,
    );
    assert.deepEqual(queries, []);
  });

  it("rejects rows of the wrong shape", async () => {
    const broken = catalog();
    broken.columns = [columnRow("users", "id", 1, { not_null: "maybe" })];
    const { session } = fakeSession(broken);
    await assert.rejects(
      introspectPostgres(session),
      PostgresIntrospectionError,
    );
  });

  it("maps catalog rows to a snapshot and reports what it does not capture", async () => {
    const { session } = fakeSession(catalog());
    const result = await introspectPostgres(session, { namespaces: ["app"] });

    assert.equal(result.serverVersion, "14.20");
    assert.deepEqual(
      result.snapshot.namespaces.map((ns) => ns.name),
      ["app"],
    );
    const [app] = result.snapshot.namespaces;
    assert.deepEqual(
      app!.tables.map((t) => t.name),
      ["users"],
    );
    assert.deepEqual(app!.enums, [{ name: "mood", values: ["sad", "happy"] }]);
    assert.deepEqual(app!.sequences, [
      {
        name: "counter",
        dataType: "integer",
        start: "10",
        increment: "2",
        minValue: "1",
        maxValue: "2147483647",
        cache: "1",
        cycle: true,
        ownedBy: null,
      },
    ]);

    const users = app!.tables[0]!;
    assert.equal(users.comment, "People");
    assert.deepEqual(users.columns, [
      {
        name: "id",
        type: "bigint",
        nullable: false,
        default: null,
        identity: "by-default",
        generated: null,
        collation: null,
        comment: null,
      },
      {
        name: "email",
        type: "text",
        nullable: false,
        default: null,
        identity: null,
        generated: null,
        collation: 'pg_catalog."C"',
        comment: "Login",
      },
      {
        name: "parent_id",
        type: "bigint",
        nullable: true,
        default: "NULL::bigint",
        identity: null,
        generated: null,
        collation: null,
        comment: null,
      },
      {
        name: "email_lower",
        type: "text",
        nullable: true,
        default: null,
        identity: null,
        generated: { kind: "stored", expression: "lower(email)" },
        collation: null,
        comment: null,
      },
    ]);
    assert.deepEqual(users.primaryKey, {
      name: "users_pkey",
      columns: ["id"],
      deferrable: "not-deferrable",
    });
    assert.deepEqual(users.uniqueConstraints, [
      {
        name: "users_email_key",
        columns: ["email"],
        nullsNotDistinct: false,
        deferrable: "deferrable",
      },
    ]);
    assert.deepEqual(users.checkConstraints, [
      { name: "users_email_check", expression: "(email <> ''::text)" },
    ]);
    assert.deepEqual(users.foreignKeys, [
      {
        name: "users_parent_fkey",
        columns: ["parent_id"],
        references: { namespace: "app", table: "users", columns: ["id"] },
        onUpdate: "no-action",
        onDelete: "set-null",
        matchFull: false,
        deferrable: "deferrable-initially-deferred",
      },
    ]);
    assert.deepEqual(users.indexes, [
      {
        name: "users_lower_email_idx",
        unique: true,
        definition:
          "CREATE UNIQUE INDEX users_lower_email_idx ON app.users USING btree (lower(email))",
      },
    ]);

    assert.deepEqual(
      result.unsupported.map((o) => [o.kind, o.table, o.name]),
      [
        ["check-no-inherit", "users", "users_legacy_check"],
        ["exclusion-constraint", "users", "users_no_overlap"],
        ["function", null, "touch()"],
        ["invalid-index", "users", "users_broken_idx"],
        ["partition", null, "events_2026"],
        ["partitioned-table", null, "events"],
        ["row-level-security", "users", "users"],
        ["sequence-of-unsupported-table", "events", "events_id_seq"],
        ["trigger", "users", "users_touch"],
        ["unlogged-table", null, "scratch"],
        ["view", null, "user_names"],
      ],
    );
  });

  it("captures every user namespace by default", async () => {
    const { session } = fakeSession(catalog());
    const result = await introspectPostgres(session);
    assert.deepEqual(
      result.snapshot.namespaces.map((ns) => [
        ns.name,
        ns.tables.map((t) => t.name),
      ]),
      [
        ["app", ["users"]],
        ["other", ["elsewhere"]],
      ],
    );
    assert.ok(
      result.unsupported.some(
        (o) => o.namespace === "other" && o.name === "not_in_scope",
      ),
    );
  });
});
