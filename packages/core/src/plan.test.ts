import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isEmptyPlan,
  planMigration,
  PlanningError,
  type MigrationPlan,
  type PlannedOperation,
  type Risk,
} from "./plan.ts";
import {
  emptySnapshot,
  type PrimaryKey,
  type SchemaSnapshot,
  type Table,
} from "./snapshot.ts";
import {
  column,
  foreignKey,
  namespace,
  sequence,
  snapshot,
  table,
} from "./testing.ts";

/** "kind namespace [table] [name]" for compact, readable order assertions. */
function label({ operation }: PlannedOperation): string {
  const fields = operation as unknown as Record<string, unknown>;
  const parts = [operation.kind, operation.namespace];
  for (const key of [
    "tableName",
    "enumName",
    "sequenceName",
    "columnName",
    "constraintName",
    "indexName",
    "value",
  ]) {
    if (typeof fields[key] === "string") parts.push(fields[key]);
  }
  for (const key of [
    "table",
    "enum",
    "sequence",
    "column",
    "index",
    "primaryKey",
    "constraint",
    "foreignKey",
  ]) {
    const nested = fields[key] as { name?: unknown } | undefined;
    if (typeof nested?.name === "string") parts.push(nested.name);
  }
  return parts.join(" ");
}

const labels = (plan: MigrationPlan): string[] => plan.operations.map(label);
const risks = (plan: MigrationPlan): Record<string, Risk> =>
  Object.fromEntries(
    plan.operations.map((planned) => [label(planned), planned.risk]),
  );

const pk = (name: string, columns: string[]): PrimaryKey => ({
  name,
  columns,
  deferrable: "not-deferrable",
});
const app = (...tables: Table[]): SchemaSnapshot =>
  snapshot(namespace("app", { tables }));

function blog(): SchemaSnapshot {
  return snapshot(
    namespace("app", {
      enums: [{ name: "mood", values: ["sad", "happy"] }],
      sequences: [
        sequence("users_id_seq", { ownedBy: { table: "users", column: "id" } }),
      ],
      tables: [
        table("users", {
          columns: [
            column("id", "integer", {
              nullable: false,
              default: "nextval('app.users_id_seq'::regclass)",
            }),
            column("mood", "app.mood"),
          ],
          primaryKey: pk("users_pkey", ["id"]),
          indexes: [
            {
              name: "users_mood_idx",
              unique: false,
              definition:
                "CREATE INDEX users_mood_idx ON app.users USING btree (mood)",
            },
          ],
          comment: "People",
        }),
        table("posts", {
          columns: [
            column("id", "integer", { nullable: false }),
            column("user_id", "integer"),
          ],
          primaryKey: pk("posts_pkey", ["id"]),
          foreignKeys: [
            foreignKey("posts_user_fkey", ["user_id"], {
              namespace: "app",
              table: "users",
              columns: ["id"],
            }),
          ],
        }),
      ],
    }),
  );
}

describe("planMigration", () => {
  it("returns an empty plan for identical snapshots", () => {
    assert.ok(isEmptyPlan(planMigration(blog(), blog())));
  });

  it("creates a schema from empty in dependency order", () => {
    const plan = planMigration(emptySnapshot("postgresql"), blog());
    assert.deepEqual(labels(plan), [
      "create-namespace app",
      "create-enum app mood",
      "create-sequence app users_id_seq",
      "create-table app posts",
      "create-table app users",
      "set-sequence-owner app users_id_seq",
      "create-index app users users_mood_idx",
      "add-foreign-key app posts posts_user_fkey",
      "comment-on-table app users",
    ]);
    assert.ok(plan.operations.every((planned) => planned.risk === "safe"));
    assert.deepEqual(plan.unsupported, []);

    const createUsers = plan.operations.find(
      (planned) => label(planned) === "create-table app users",
    )!.operation;
    assert.equal(createUsers.kind, "create-table");
    if (createUsers.kind === "create-table") {
      assert.deepEqual(createUsers.table.indexes, []);
      assert.deepEqual(createUsers.table.foreignKeys, []);
      assert.equal(createUsers.table.comment, null);
    }
  });

  it("drops a schema with foreign keys first, implicit sequence drops skipped, namespace last", () => {
    const plan = planMigration(blog(), emptySnapshot("postgresql"));
    assert.deepEqual(labels(plan), [
      "drop-constraint app posts posts_user_fkey",
      "drop-table app posts",
      "drop-table app users",
      "drop-enum app mood",
      "drop-namespace app",
    ]);
    assert.deepEqual(risks(plan), {
      "drop-constraint app posts posts_user_fkey": "safe",
      "drop-table app posts": "destructive",
      "drop-table app users": "destructive",
      "drop-enum app mood": "destructive",
      "drop-namespace app": "destructive",
    });
  });

  it("orders column changes and rates their risk", () => {
    const before = app(
      table("users", {
        columns: [
          column("id", "integer", { nullable: false }),
          column("email", "text", { nullable: false }),
          column("nickname", "text"),
          column("age", "integer", { default: "0" }),
          column("legacy", "text"),
        ],
      }),
    );
    const after = app(
      table("users", {
        columns: [
          column("id", "integer", { nullable: false }),
          column("email", "text", { comment: "Login" }),
          column("nickname", "text", { nullable: false }),
          column("age", "bigint", { default: "0" }),
          column("score", "integer", { nullable: false }),
          column("bio", "text"),
        ],
      }),
    );
    const plan = planMigration(before, after);
    assert.deepEqual(labels(plan), [
      "drop-column app users legacy",
      "add-column app users bio",
      "add-column app users score",
      "drop-column-default app users age",
      "alter-column-type app users age",
      "set-column-default app users age",
      "drop-not-null app users email",
      "set-not-null app users nickname",
      "comment-on-column app users email",
    ]);
    assert.deepEqual(risks(plan), {
      "drop-column app users legacy": "destructive",
      "add-column app users bio": "safe",
      "add-column app users score": "caution",
      "drop-column-default app users age": "safe",
      "alter-column-type app users age": "destructive",
      "set-column-default app users age": "safe",
      "drop-not-null app users email": "safe",
      "set-not-null app users nickname": "caution",
      "comment-on-column app users email": "safe",
    });
  });

  it("ignores column position", () => {
    const columns = [column("id", "integer"), column("email", "text")];
    const plan = planMigration(
      app(table("users", { columns })),
      app(table("users", { columns: [...columns].reverse() })),
    );
    assert.ok(isEmptyPlan(plan));
  });

  it("rates new columns that need a default, values or rewrite", () => {
    const plan = planMigration(
      app(table("t", { columns: [column("a", "integer")] })),
      app(
        table("t", {
          columns: [
            column("a", "integer"),
            column("b", "integer", { nullable: false, default: "0" }),
            column("c", "integer", {
              generated: { kind: "stored", expression: "(a * 2)" },
            }),
            column("d", "bigint", { nullable: false, identity: "always" }),
          ],
        }),
      ),
    );
    assert.deepEqual(risks(plan), {
      "add-column app t b": "safe",
      "add-column app t c": "caution",
      "add-column app t d": "safe",
    });
  });

  it("switches a serial-style column to identity: default dropped before identity is added", () => {
    const plan = planMigration(
      app(
        table("t", {
          columns: [
            column("id", "integer", {
              nullable: false,
              default: "nextval('app.t_id_seq'::regclass)",
            }),
          ],
        }),
      ),
      app(
        table("t", {
          columns: [
            column("id", "integer", {
              nullable: false,
              identity: "by-default",
            }),
          ],
        }),
      ),
    );
    assert.deepEqual(labels(plan), [
      "drop-column-default app t id",
      "alter-column-identity app t id",
    ]);
    assert.equal(plan.operations[1]!.risk, "caution");
  });

  it("changes or drops identity before defaults are set", () => {
    const plan = planMigration(
      app(
        table("t", {
          columns: [
            column("a", "bigint", { nullable: false, identity: "always" }),
            column("b", "bigint", { nullable: false, identity: "always" }),
          ],
        }),
      ),
      app(
        table("t", {
          columns: [
            column("a", "bigint", { nullable: false, identity: "by-default" }),
            column("b", "bigint", { nullable: false, default: "0" }),
          ],
        }),
      ),
    );
    assert.deepEqual(labels(plan), [
      "alter-column-identity app t a",
      "alter-column-identity app t b",
      "set-column-default app t b",
    ]);
    assert.ok(plan.operations.every((planned) => planned.risk === "safe"));
  });

  it("adds enum values in positions that reproduce the target order", () => {
    const enums = (values: string[]) =>
      snapshot(namespace("app", { enums: [{ name: "e", values }] }));
    const append = planMigration(
      enums(["a", "b"]),
      enums(["a", "x", "b", "y"]),
    );
    assert.deepEqual(
      append.operations.map(({ operation }) =>
        operation.kind === "add-enum-value"
          ? [operation.value, operation.position]
          : null,
      ),
      [
        ["x", { after: "a" }],
        ["y", { after: "b" }],
      ],
    );
    const prepend = planMigration(
      enums(["a", "b"]),
      enums(["x", "y", "a", "b"]),
    );
    assert.deepEqual(
      prepend.operations.map(({ operation }) =>
        operation.kind === "add-enum-value"
          ? [operation.value, operation.position]
          : null,
      ),
      [
        ["x", { before: "a" }],
        ["y", { after: "x" }],
      ],
    );
    const fromEmpty = planMigration(enums([]), enums(["x"]));
    assert.deepEqual(
      fromEmpty.operations.map(({ operation }) =>
        operation.kind === "add-enum-value" ? operation.position : undefined,
      ),
      [null],
    );
  });

  it("reports enum value removal and reordering as unsupported", () => {
    const enums = (values: string[]) =>
      snapshot(namespace("app", { enums: [{ name: "e", values }] }));
    for (const values of [["a"], ["b", "a"]]) {
      const plan = planMigration(enums(["a", "b"]), enums(values));
      assert.deepEqual(plan.operations, []);
      assert.equal(plan.unsupported.length, 1);
      assert.equal(plan.unsupported[0]!.object, "app.e");
    }
  });

  it("reports generated column changes as unsupported", () => {
    const plan = planMigration(
      app(
        table("t", {
          columns: [
            column("a", "integer"),
            column("b", "integer", {
              generated: { kind: "stored", expression: "(a + 1)" },
            }),
          ],
        }),
      ),
      app(
        table("t", {
          columns: [
            column("a", "integer"),
            column("b", "integer", {
              generated: { kind: "stored", expression: "(a + 2)" },
            }),
          ],
        }),
      ),
    );
    assert.deepEqual(plan.operations, []);
    assert.deepEqual(
      plan.unsupported.map((change) => change.object),
      ["app.t.b"],
    );
    assert.equal(isEmptyPlan(plan), false);
  });

  it("drops and re-adds changed constraints and indexes", () => {
    const base = {
      columns: [
        column("id", "integer", { nullable: false }),
        column("code", "text"),
        column("ref", "integer"),
      ],
      primaryKey: pk("t_pkey", ["id"]),
    };
    const plan = planMigration(
      app(
        table("t", {
          ...base,
          checkConstraints: [
            { name: "t_code_check", expression: "(code <> '')" },
          ],
          indexes: [
            {
              name: "t_code_idx",
              unique: false,
              definition: "CREATE INDEX t_code_idx ON app.t USING btree (code)",
            },
          ],
          foreignKeys: [
            foreignKey("t_old_fkey", ["ref"], {
              namespace: "app",
              table: "t",
              columns: ["id"],
            }),
          ],
        }),
      ),
      app(
        table("t", {
          ...base,
          checkConstraints: [
            { name: "t_code_check", expression: "(length(code) > 2)" },
          ],
          indexes: [
            {
              name: "t_code_idx",
              unique: false,
              definition: "CREATE INDEX t_code_idx ON app.t USING hash (code)",
            },
          ],
          uniqueConstraints: [
            {
              name: "t_code_key",
              columns: ["code"],
              nullsNotDistinct: false,
              deferrable: "not-deferrable",
            },
          ],
          foreignKeys: [
            foreignKey("t_new_fkey", ["ref"], {
              namespace: "app",
              table: "t",
              columns: ["id"],
            }),
          ],
        }),
      ),
    );
    assert.deepEqual(labels(plan), [
      "drop-constraint app t t_old_fkey",
      "drop-constraint app t t_code_check",
      "drop-index app t t_code_idx",
      "add-check app t t_code_check",
      "create-index app t t_code_idx",
      "add-unique app t t_code_key",
      "add-foreign-key app t t_new_fkey",
    ]);
    assert.deepEqual(risks(plan), {
      "drop-constraint app t t_old_fkey": "safe",
      "drop-constraint app t t_code_check": "safe",
      "drop-index app t t_code_idx": "safe",
      "add-check app t t_code_check": "caution",
      "create-index app t t_code_idx": "caution",
      "add-unique app t t_code_key": "caution",
      "add-foreign-key app t t_new_fkey": "caution",
    });
  });

  it("recreates unchanged foreign keys around a recreated primary key", () => {
    const before = blog();
    const after = blog();
    after.namespaces[0]!.tables[0]!.primaryKey = pk("users_pk", ["id"]);
    const plan = planMigration(before, after);
    assert.deepEqual(labels(plan), [
      "drop-constraint app posts posts_user_fkey",
      "drop-constraint app users users_pkey",
      "add-primary-key app users users_pk",
      "add-foreign-key app posts posts_user_fkey",
    ]);
    assert.equal(plan.operations[3]!.risk, "caution");
  });

  it("recreates unchanged foreign keys around column type changes", () => {
    const before = blog();
    const after = blog();
    const [users, posts] = after.namespaces[0]!.tables;
    users!.columns[0]!.type = "bigint";
    posts!.columns[1]!.type = "bigint";
    assert.deepEqual(labels(planMigration(before, after)), [
      "drop-constraint app posts posts_user_fkey",
      "drop-column-default app users id",
      "alter-column-type app posts user_id",
      "alter-column-type app users id",
      "set-column-default app users id",
      "add-foreign-key app posts posts_user_fkey",
    ]);
  });

  it("handles foreign key cycles between new and dropped tables", () => {
    const cycle = app(
      table("a", {
        columns: [
          column("id", "integer", { nullable: false }),
          column("b_id", "integer"),
        ],
        primaryKey: pk("a_pkey", ["id"]),
        foreignKeys: [
          foreignKey("a_b_fkey", ["b_id"], {
            namespace: "app",
            table: "b",
            columns: ["id"],
          }),
        ],
      }),
      table("b", {
        columns: [
          column("id", "integer", { nullable: false }),
          column("a_id", "integer"),
        ],
        primaryKey: pk("b_pkey", ["id"]),
        foreignKeys: [
          foreignKey("b_a_fkey", ["a_id"], {
            namespace: "app",
            table: "a",
            columns: ["id"],
          }),
        ],
      }),
    );
    const empty = snapshot(namespace("app"));
    assert.deepEqual(labels(planMigration(empty, cycle)), [
      "create-table app a",
      "create-table app b",
      "add-foreign-key app a a_b_fkey",
      "add-foreign-key app b b_a_fkey",
    ]);
    assert.deepEqual(labels(planMigration(cycle, empty)), [
      "drop-constraint app a a_b_fkey",
      "drop-constraint app b b_a_fkey",
      "drop-table app a",
      "drop-table app b",
    ]);
  });

  it("alters sequences and moves ownership safely", () => {
    const withSequences = (
      counter: Partial<Parameters<typeof sequence>[1]>,
      owned: Partial<Parameters<typeof sequence>[1]>,
      extra: ReturnType<typeof sequence>[] = [],
    ) =>
      snapshot(
        namespace("app", {
          tables: [
            table("t", {
              columns: [column("id", "integer"), column("other", "integer")],
            }),
          ],
          sequences: [
            sequence("counter", counter),
            sequence("owned", owned),
            ...extra,
          ],
        }),
      );
    const plan = planMigration(
      withSequences(
        { increment: "1" },
        { ownedBy: { table: "t", column: "id" } },
        [sequence("standalone")],
      ),
      withSequences(
        { increment: "5", maxValue: "1000" },
        { ownedBy: { table: "t", column: "other" } },
      ),
    );
    assert.deepEqual(labels(plan), [
      "alter-sequence app counter",
      "set-sequence-owner app owned",
      "set-sequence-owner app owned",
      "drop-sequence app standalone",
    ]);
    assert.deepEqual(
      plan.operations.map(({ operation, risk }) => [
        operation.kind === "set-sequence-owner" ? operation.ownedBy : null,
        risk,
      ]),
      [
        [null, "caution"],
        [null, "safe"],
        [{ table: "t", column: "other" }, "safe"],
        [null, "destructive"],
      ],
    );
  });

  it("does not drop a sequence that goes away with its owning column", () => {
    const plan = planMigration(
      snapshot(
        namespace("app", {
          tables: [
            table("t", {
              columns: [column("id", "integer"), column("n", "integer")],
            }),
          ],
          sequences: [
            sequence("t_n_seq", { ownedBy: { table: "t", column: "n" } }),
          ],
        }),
      ),
      snapshot(
        namespace("app", {
          tables: [table("t", { columns: [column("id", "integer")] })],
        }),
      ),
    );
    assert.deepEqual(labels(plan), ["drop-column app t n"]);
  });

  it("is deterministic regardless of input order", () => {
    const shuffled = blog();
    shuffled.namespaces[0]!.tables.reverse();
    assert.deepEqual(
      planMigration(emptySnapshot("postgresql"), shuffled),
      planMigration(emptySnapshot("postgresql"), blog()),
    );
  });

  it("refuses to plan across dialects", () => {
    const other = { ...blog(), dialect: "mysql" } as unknown as SchemaSnapshot;
    assert.throws(() => planMigration(blog(), other), PlanningError);
  });
});
