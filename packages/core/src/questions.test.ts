import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  answersOf,
  openQuestions,
  planMigration,
  PlanningError,
  type Answers,
  type MigrationPlan,
  type PlannedOperation,
} from "./plan.ts";
import type { PrimaryKey, SchemaSnapshot, Table } from "./snapshot.ts";
import {
  column,
  foreignKey,
  namespace,
  sequence,
  snapshot,
  table,
} from "./testing.ts";

function label({ operation }: PlannedOperation): string {
  const fields = operation as unknown as Record<string, unknown>;
  const parts = [operation.kind, operation.namespace];
  for (const key of [
    "tableName",
    "sequenceName",
    "columnName",
    "constraintName",
    "indexName",
    "newName",
  ]) {
    if (typeof fields[key] === "string") parts.push(fields[key]);
  }
  for (const key of ["column", "index", "primaryKey", "foreignKey"]) {
    const nested = fields[key] as { name?: unknown } | undefined;
    if (typeof nested?.name === "string") parts.push(nested.name);
  }
  return parts.join(" ");
}

const labels = (plan: MigrationPlan): string[] => plan.operations.map(label);
const ids = (plan: MigrationPlan): string[] =>
  plan.questions.map((question) => question.id);

const pk = (name: string, columns: string[]): PrimaryKey => ({
  name,
  columns,
  deferrable: "not-deferrable",
});
const app = (...tables: Table[]): SchemaSnapshot =>
  snapshot(namespace("app", { tables }));

/** A Prisma-style model before and after renaming the model `User` to `Account`. */
function model(name: string): SchemaSnapshot {
  return snapshot(
    namespace("public", {
      sequences: [
        sequence(`${name}_id_seq`, { ownedBy: { table: name, column: "id" } }),
      ],
      tables: [
        table(name, {
          columns: [
            column("id", "integer", {
              nullable: false,
              default: `nextval('"${name}_id_seq"'::regclass)`,
            }),
            column("email", "text", { nullable: false }),
          ],
          primaryKey: pk(`${name}_pkey`, ["id"]),
          indexes: [
            {
              name: `${name}_email_key`,
              unique: true,
              definition: `CREATE UNIQUE INDEX "${name}_email_key" ON public."${name}" USING btree (email)`,
            },
          ],
        }),
        table("Post", {
          columns: [
            column("id", "integer", { nullable: false }),
            column("authorId", "integer", { nullable: false }),
          ],
          primaryKey: pk("Post_pkey", ["id"]),
          foreignKeys: [
            foreignKey("Post_authorId_fkey", ["authorId"], {
              namespace: "public",
              table: name,
              columns: ["id"],
            }),
          ],
        }),
      ],
    }),
  );
}

const users = (...columns: ReturnType<typeof column>[]): SchemaSnapshot =>
  app(
    table("users", {
      columns: [column("id", "integer", { nullable: false }), ...columns],
      primaryKey: pk("users_pkey", ["id"]),
    }),
  );

const before = () =>
  users(column("full_name", "text"), column("email", "text"));
const after = () =>
  users(
    column("name", "text"),
    column("email", "text"),
    column("role", "text", { nullable: false }),
  );

const RENAME_FULL_NAME = '["rename-column","app","users","full_name"]';
const BACKFILL_ROLE = '["backfill","app","users","role"]';

describe("guided planning", () => {
  it("asks instead of guessing, and plans drop plus add until answered", () => {
    const plan = planMigration(before(), after());
    assert.deepEqual(plan.questions, [
      {
        id: RENAME_FULL_NAME,
        kind: "rename-column",
        namespace: "app",
        tableName: "users",
        columnName: "full_name",
        candidates: ["name", "role"],
        answer: null,
      },
      {
        id: BACKFILL_ROLE,
        kind: "backfill",
        namespace: "app",
        tableName: "users",
        columnName: "role",
        type: "text",
        answer: null,
      },
    ]);
    assert.equal(openQuestions(plan).length, 2);
    assert.deepEqual(labels(plan), [
      "drop-column app users full_name",
      "add-column app users name",
      "add-column app users role",
    ]);
  });

  it("renames a column and backfills an added NOT NULL column", () => {
    const answers: Answers = {
      [RENAME_FULL_NAME]: { choice: "rename", to: "name" },
      [BACKFILL_ROLE]: { choice: "backfill", value: "member" },
    };
    const plan = planMigration(before(), after(), { answers });
    assert.deepEqual(labels(plan), [
      "rename-column app users full_name name",
      "add-column app users role",
      "drop-column-default app users role",
    ]);
    assert.deepEqual(openQuestions(plan), []);
    assert.deepEqual(answersOf(plan), answers);
    const added = plan.operations[1]!;
    assert.equal(added.risk, "safe");
    assert.ok(
      added.operation.kind === "add-column" &&
        added.operation.backfill === "member",
    );
    assert.match(added.warnings[0]!, /Existing rows get the value "member"/);
    assert.equal(plan.operations[0]!.risk, "caution");
    assert.ok(
      plan.operations.every((planned) => planned.risk !== "destructive"),
    );
  });

  it("lets earlier answers decide which later questions exist", () => {
    // Renamed to "role", the column already exists, so nothing needs a backfill.
    const plan = planMigration(before(), after(), {
      answers: { [RENAME_FULL_NAME]: { choice: "rename", to: "role" } },
    });
    assert.deepEqual(ids(plan), [RENAME_FULL_NAME]);
    assert.deepEqual(labels(plan), [
      "rename-column app users full_name role",
      "add-column app users name",
      "set-not-null app users role",
    ]);
  });

  it("rejects answers that match no question, unless told to drop them", () => {
    const answers: Answers = {
      [RENAME_FULL_NAME]: { choice: "rename", to: "role" },
      [BACKFILL_ROLE]: { choice: "backfill", value: "member" },
    };
    assert.throws(
      () => planMigration(before(), after(), { answers }),
      (error: unknown) =>
        error instanceof PlanningError && error.message.includes(BACKFILL_ROLE),
    );
    const plan = planMigration(before(), after(), {
      answers,
      ignoreUnusedAnswers: true,
    });
    assert.deepEqual(answersOf(plan), {
      [RENAME_FULL_NAME]: { choice: "rename", to: "role" },
    });
  });

  it("keeps drop plus add when the answer is drop, and leaves nothing open", () => {
    const plan = planMigration(before(), after(), {
      answers: {
        [RENAME_FULL_NAME]: { choice: "drop" },
        [BACKFILL_ROLE]: { choice: "skip" },
      },
    });
    assert.deepEqual(openQuestions(plan), []);
    assert.deepEqual(labels(plan), [
      "drop-column app users full_name",
      "add-column app users name",
      "add-column app users role",
    ]);
    assert.equal(plan.operations[2]!.risk, "caution");
  });

  it("rejects invalid answers", () => {
    const attempt = (answers: Record<string, unknown>) => () =>
      planMigration(before(), after(), { answers: answers as Answers });
    assert.throws(
      attempt({ [RENAME_FULL_NAME]: { choice: "rename", to: "email" } }),
      /cannot be renamed to "email"/,
    );
    assert.throws(
      attempt({ [RENAME_FULL_NAME]: { choice: "maybe" } }),
      PlanningError,
    );
    assert.throws(
      attempt({ [BACKFILL_ROLE]: { choice: "rename", to: "x" } }),
      PlanningError,
    );
    assert.throws(
      attempt({ [BACKFILL_ROLE]: { choice: "backfill", value: 42 } }),
      PlanningError,
    );
    assert.throws(attempt({ [BACKFILL_ROLE]: null }), PlanningError);
  });

  it("refuses two renames to the same name", () => {
    const from = users(column("first", "text"), column("second", "text"));
    const to = users(column("name", "text"));
    assert.throws(
      () =>
        planMigration(from, to, {
          answers: {
            '["rename-column","app","users","first"]': {
              choice: "rename",
              to: "name",
            },
            '["rename-column","app","users","second"]': {
              choice: "rename",
              to: "name",
            },
          },
        }),
      /cannot both be renamed to "name"/,
    );
  });

  it("only offers columns of the same type, collation and generation", () => {
    const from = users(column("a", "text"), column("b", "integer"));
    const to = users(
      column("c", "text", { collation: '"C"' }),
      column("d", "bigint"),
    );
    assert.deepEqual(planMigration(from, to).questions, []);
  });

  it("does not ask for backfills that are not needed", () => {
    const from = users();
    const to = app(
      table("users", {
        columns: [
          column("id", "integer", { nullable: false }),
          column("optional", "text"),
          column("defaulted", "text", {
            nullable: false,
            default: "'x'::text",
          }),
          column("counter", "integer", {
            nullable: false,
            identity: "by-default",
          }),
        ],
        primaryKey: pk("users_pkey", ["id"]),
      }),
      table("fresh", {
        columns: [column("required", "text", { nullable: false })],
      }),
    );
    assert.deepEqual(planMigration(from, to).questions, []);
  });

  it("renames a table, follows its references, then asks about its sequence", () => {
    const tableQuestion = '["rename-table","public","User"]';
    const sequenceQuestion = '["rename-sequence","public","User_id_seq"]';

    const unanswered = planMigration(model("User"), model("Account"));
    // The sequence goes away with its table until the table counts as renamed.
    assert.deepEqual(ids(unanswered), [tableQuestion]);
    assert.ok(labels(unanswered).includes("drop-table public User"));

    const tableOnly = planMigration(model("User"), model("Account"), {
      answers: { [tableQuestion]: { choice: "rename", to: "Account" } },
    });
    assert.deepEqual(ids(tableOnly), [tableQuestion, sequenceQuestion]);
    assert.deepEqual(tableOnly.questions[1]!, {
      id: sequenceQuestion,
      kind: "rename-sequence",
      namespace: "public",
      sequenceName: "User_id_seq",
      candidates: ["Account_id_seq"],
      answer: null,
    });

    const plan = planMigration(model("User"), model("Account"), {
      answers: {
        [tableQuestion]: { choice: "rename", to: "Account" },
        [sequenceQuestion]: { choice: "rename", to: "Account_id_seq" },
      },
    });
    assert.deepEqual(labels(plan), [
      "rename-table public User Account",
      "rename-sequence public User_id_seq Account_id_seq",
      "drop-constraint public Post Post_authorId_fkey",
      "drop-index public Account User_email_key",
      "drop-constraint public Account User_pkey",
      "set-column-default public Account id",
      "create-index public Account Account_email_key",
      "add-primary-key public Account Account_pkey",
      "add-foreign-key public Post Post_authorId_fkey",
    ]);
    assert.ok(
      plan.operations.every((planned) => planned.risk !== "destructive"),
    );
  });

  it("does not ask about a sequence that goes away with its owning column", () => {
    const from = snapshot(
      namespace("app", {
        sequences: [
          sequence("t_n_seq", { ownedBy: { table: "t", column: "n" } }),
        ],
        tables: [table("t", { columns: [column("n", "integer")] })],
      }),
    );
    const to = snapshot(
      namespace("app", {
        sequences: [sequence("other_seq")],
        tables: [table("t", { columns: [column("m", "bigint")] })],
      }),
    );
    assert.deepEqual(planMigration(from, to).questions, []);
  });

  it("is deterministic regardless of input order", () => {
    const answers: Answers = {
      [RENAME_FULL_NAME]: { choice: "rename", to: "name" },
    };
    const shuffled = after();
    shuffled.namespaces[0]!.tables[0]!.columns.reverse();
    const reversed = before();
    reversed.namespaces[0]!.tables[0]!.columns.reverse();
    assert.deepEqual(
      planMigration(reversed, shuffled, { answers }),
      planMigration(before(), after(), { answers }),
    );
  });
});
