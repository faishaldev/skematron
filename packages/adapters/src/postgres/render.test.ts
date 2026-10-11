import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MigrationPlan, Operation } from "@skematron/core";
import { column, foreignKey, sequence, table } from "@skematron/core/testing";
import { commentText, quoteIdent, quoteLiteral } from "./quote.ts";
import { renderIndexDefinition, renderPostgresMigration } from "./render.ts";

function plan(
  operations: Operation[],
  unsupported: MigrationPlan["unsupported"] = [],
): MigrationPlan {
  return {
    dialect: "postgresql",
    operations: operations.map((operation) => ({
      operation,
      risk: "safe",
      warnings: [],
    })),
    unsupported,
    questions: [],
  };
}

const orders = { namespace: "app", tableName: "orders" } as const;
const qty = { ...orders, columnName: "qty" } as const;

const CASES: [Operation, string][] = [
  [
    {
      kind: "rename-table",
      namespace: "app",
      tableName: "users",
      newName: "Account",
    },
    `ALTER TABLE "app"."users" RENAME TO "Account"`,
  ],
  [
    { kind: "rename-column", ...qty, newName: "quantity" },
    `ALTER TABLE "app"."orders" RENAME COLUMN "qty" TO "quantity"`,
  ],
  [
    {
      kind: "rename-sequence",
      namespace: "app",
      sequenceName: "users_id_seq",
      newName: "Account_id_seq",
    },
    `ALTER SEQUENCE "app"."users_id_seq" RENAME TO "Account_id_seq"`,
  ],
  [
    {
      kind: "add-column",
      ...orders,
      column: column("owner", "text", { nullable: false }),
      backfill: "O'Brien",
    },
    `ALTER TABLE "app"."orders" ADD COLUMN "owner" text DEFAULT 'O''Brien'::text NOT NULL`,
  ],
  [
    {
      kind: "add-column",
      ...orders,
      column: column("path", "character varying(20)", { nullable: false }),
      backfill: "C:\\tmp",
    },
    `ALTER TABLE "app"."orders" ADD COLUMN "path" character varying(20) DEFAULT E'C:\\\\tmp'::character varying(20) NOT NULL`,
  ],
  [
    { kind: "create-namespace", namespace: "app" },
    `CREATE SCHEMA IF NOT EXISTS "app"`,
  ],
  [{ kind: "drop-namespace", namespace: "app" }, `DROP SCHEMA "app"`],
  [
    {
      kind: "create-enum",
      namespace: "app",
      enum: { name: "mood", values: ["sad", "it's ok"] },
    },
    `CREATE TYPE "app"."mood" AS ENUM ('sad', 'it''s ok')`,
  ],
  [
    {
      kind: "add-enum-value",
      namespace: "app",
      enumName: "mood",
      value: "happy",
      position: { after: "sad" },
    },
    `ALTER TYPE "app"."mood" ADD VALUE 'happy' AFTER 'sad'`,
  ],
  [
    {
      kind: "add-enum-value",
      namespace: "app",
      enumName: "mood",
      value: "meh",
      position: { before: "sad" },
    },
    `ALTER TYPE "app"."mood" ADD VALUE 'meh' BEFORE 'sad'`,
  ],
  [
    {
      kind: "add-enum-value",
      namespace: "app",
      enumName: "mood",
      value: "first",
      position: null,
    },
    `ALTER TYPE "app"."mood" ADD VALUE 'first'`,
  ],
  [
    { kind: "drop-enum", namespace: "app", enumName: "mood" },
    `DROP TYPE "app"."mood"`,
  ],
  [
    {
      kind: "create-sequence",
      namespace: "app",
      sequence: sequence("s", {
        dataType: "bigint",
        start: "100",
        increment: "5",
        maxValue: "9223372036854775807",
        cycle: true,
      }),
    },
    `CREATE SEQUENCE "app"."s" AS bigint INCREMENT BY 5 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100 CACHE 1 CYCLE`,
  ],
  [
    { kind: "alter-sequence", namespace: "app", sequence: sequence("s") },
    `ALTER SEQUENCE "app"."s" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE`,
  ],
  [
    {
      kind: "set-sequence-owner",
      namespace: "app",
      sequenceName: "s",
      ownedBy: { table: "orders", column: "id" },
    },
    `ALTER SEQUENCE "app"."s" OWNED BY "app"."orders"."id"`,
  ],
  [
    {
      kind: "set-sequence-owner",
      namespace: "app",
      sequenceName: "s",
      ownedBy: null,
    },
    `ALTER SEQUENCE "app"."s" OWNED BY NONE`,
  ],
  [
    { kind: "drop-sequence", namespace: "app", sequenceName: "s" },
    `DROP SEQUENCE "app"."s"`,
  ],
  [
    {
      kind: "create-table",
      namespace: "app",
      table: table("orders", {
        columns: [
          column("id", "bigint", { nullable: false, identity: "by-default" }),
          column("status", "app.status", {
            nullable: false,
            default: "'new'::app.status",
          }),
          column("total", "numeric", {
            generated: { kind: "stored", expression: "(qty * price)" },
          }),
          column("code", "text", { collation: 'pg_catalog."C"' }),
        ],
        primaryKey: {
          name: "orders_pkey",
          columns: ["id"],
          deferrable: "not-deferrable",
        },
        uniqueConstraints: [
          {
            name: "orders_code_key",
            columns: ["code"],
            nullsNotDistinct: false,
            deferrable: "not-deferrable",
          },
        ],
        checkConstraints: [
          { name: "orders_total_check", expression: "(total > (0)::numeric)" },
        ],
      }),
    },
    `CREATE TABLE "app"."orders" (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "status" app.status DEFAULT 'new'::app.status NOT NULL,
  "total" numeric GENERATED ALWAYS AS ((qty * price)) STORED,
  "code" text COLLATE pg_catalog."C",
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_code_key" UNIQUE ("code"),
  CONSTRAINT "orders_total_check" CHECK ((total > (0)::numeric))
)`,
  ],
  [
    { kind: "create-table", namespace: "app", table: table("empty") },
    `CREATE TABLE "app"."empty" ()`,
  ],
  [{ kind: "drop-table", ...orders }, `DROP TABLE "app"."orders"`],
  [
    {
      kind: "add-column",
      ...orders,
      column: column("note", "text", { nullable: false, default: "''::text" }),
    },
    `ALTER TABLE "app"."orders" ADD COLUMN "note" text DEFAULT ''::text NOT NULL`,
  ],
  [
    { kind: "drop-column", ...orders, columnName: "note" },
    `ALTER TABLE "app"."orders" DROP COLUMN "note"`,
  ],
  [
    { kind: "alter-column-type", ...qty, type: "bigint", collation: null },
    `ALTER TABLE "app"."orders" ALTER COLUMN "qty" TYPE bigint`,
  ],
  [
    {
      kind: "alter-column-type",
      ...qty,
      type: "text",
      collation: 'pg_catalog."C"',
    },
    `ALTER TABLE "app"."orders" ALTER COLUMN "qty" TYPE text COLLATE pg_catalog."C"`,
  ],
  [
    { kind: "set-column-default", ...qty, default: "0" },
    `ALTER TABLE "app"."orders" ALTER COLUMN "qty" SET DEFAULT 0`,
  ],
  [
    { kind: "drop-column-default", ...qty },
    `ALTER TABLE "app"."orders" ALTER COLUMN "qty" DROP DEFAULT`,
  ],
  [
    { kind: "set-not-null", ...qty },
    `ALTER TABLE "app"."orders" ALTER COLUMN "qty" SET NOT NULL`,
  ],
  [
    { kind: "drop-not-null", ...qty },
    `ALTER TABLE "app"."orders" ALTER COLUMN "qty" DROP NOT NULL`,
  ],
  [
    { kind: "alter-column-identity", ...qty, from: null, to: "always" },
    `ALTER TABLE "app"."orders" ALTER COLUMN "qty" ADD GENERATED ALWAYS AS IDENTITY`,
  ],
  [
    { kind: "alter-column-identity", ...qty, from: "always", to: "by-default" },
    `ALTER TABLE "app"."orders" ALTER COLUMN "qty" SET GENERATED BY DEFAULT`,
  ],
  [
    { kind: "alter-column-identity", ...qty, from: "by-default", to: null },
    `ALTER TABLE "app"."orders" ALTER COLUMN "qty" DROP IDENTITY`,
  ],
  [
    {
      kind: "add-primary-key",
      ...orders,
      primaryKey: {
        name: "orders_pkey",
        columns: ["id"],
        deferrable: "not-deferrable",
      },
    },
    `ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id")`,
  ],
  [
    {
      kind: "add-unique",
      ...orders,
      constraint: {
        name: "orders_ab_key",
        columns: ["a", "b"],
        nullsNotDistinct: true,
        deferrable: "deferrable",
      },
    },
    `ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_ab_key" UNIQUE NULLS NOT DISTINCT ("a", "b") DEFERRABLE`,
  ],
  [
    {
      kind: "add-check",
      ...orders,
      constraint: { name: "orders_qty_check", expression: "(qty > 0)" },
    },
    `ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_qty_check" CHECK ((qty > 0))`,
  ],
  [
    {
      kind: "add-foreign-key",
      ...orders,
      foreignKey: foreignKey(
        "orders_customer_fkey",
        ["customer_id"],
        { namespace: "crm", table: "customers", columns: ["id"] },
        {
          onUpdate: "restrict",
          onDelete: "cascade",
          matchFull: true,
          deferrable: "deferrable-initially-deferred",
        },
      ),
    },
    `ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm"."customers" ("id") MATCH FULL ON UPDATE RESTRICT ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED`,
  ],
  [
    {
      kind: "drop-constraint",
      ...orders,
      constraintName: "orders_customer_fkey",
      constraintKind: "foreign-key",
    },
    `ALTER TABLE "app"."orders" DROP CONSTRAINT "orders_customer_fkey"`,
  ],
  [
    {
      kind: "create-index",
      ...orders,
      index: {
        name: "orders_qty_idx",
        unique: false,
        definition:
          "CREATE INDEX orders_qty_idx ON app.orders USING btree (qty)",
      },
    },
    `CREATE INDEX orders_qty_idx ON app.orders USING btree (qty)`,
  ],
  [
    { kind: "drop-index", ...orders, indexName: "orders_qty_idx" },
    `DROP INDEX "app"."orders_qty_idx"`,
  ],
  [
    { kind: "comment-on-table", ...orders, comment: "Orders" },
    `COMMENT ON TABLE "app"."orders" IS 'Orders'`,
  ],
  [
    { kind: "comment-on-table", ...orders, comment: null },
    `COMMENT ON TABLE "app"."orders" IS NULL`,
  ],
  [
    { kind: "comment-on-column", ...qty, comment: "C:\\path" },
    `COMMENT ON COLUMN "app"."orders"."qty" IS E'C:\\\\path'`,
  ],
];

describe("renderPostgresMigration", () => {
  for (const [operation, expected] of CASES) {
    it(`renders ${operation.kind}: ${expected.split("\n")[0]}`, () => {
      const { statements } = renderPostgresMigration(plan([operation]));
      assert.equal(statements[0]!.sql, expected);
    });
  }

  it("renders a reviewable script with risks, warnings and unsupported changes", () => {
    const script = renderPostgresMigration({
      dialect: "postgresql",
      operations: [
        {
          operation: { kind: "drop-table", namespace: "app", tableName: "old" },
          risk: "destructive",
          warnings: ["Deletes rows."],
        },
        {
          operation: {
            kind: "set-not-null",
            namespace: "app",
            tableName: "t",
            columnName: "c",
          },
          risk: "caution",
          warnings: ["Fails on NULLs.", "Scans the table."],
        },
        {
          operation: { kind: "create-namespace", namespace: "new" },
          risk: "safe",
          warnings: [],
        },
      ],
      unsupported: [{ object: "app.e", reason: "Enum values were removed." }],
      questions: [],
    }).script;
    assert.equal(
      script,
      `-- Skematron migration plan for PostgreSQL. Nothing has been executed.
-- Review every statement before applying it.
-- Operations: 3 (1 destructive, 1 caution, 1 safe)
--
-- UNSUPPORTED CHANGES: this plan is incomplete. Handle these manually:
--   app.e: Enum values were removed.
--
-- DESTRUCTIVE OPERATIONS:
--   DROP TABLE "app"."old"

-- [destructive] Deletes rows.
DROP TABLE "app"."old";

-- [caution] Fails on NULLs. Scans the table.
ALTER TABLE "app"."t" ALTER COLUMN "c" SET NOT NULL;

-- [safe]
CREATE SCHEMA IF NOT EXISTS "new";
`,
    );
  });

  it("warns about open questions in the script header", () => {
    const { script } = renderPostgresMigration({
      ...plan([{ kind: "drop-table", namespace: "app", tableName: "old" }]),
      questions: [
        {
          id: '["rename-table","app","old"]',
          kind: "rename-table",
          namespace: "app",
          tableName: "old",
          candidates: ["new"],
          answer: null,
        },
      ],
    });
    assert.match(
      script,
      /^-- OPEN QUESTIONS: 1\. Answer them before applying/m,
    );
  });

  it("rejects a backfill value that PostgreSQL strings cannot hold", () => {
    assert.throws(() =>
      renderPostgresMigration(
        plan([
          {
            kind: "add-column",
            ...orders,
            column: column("c", "text", { nullable: false }),
            backfill: "a\0b",
          },
        ]),
      ),
    );
  });

  it("says so when there is nothing to do", () => {
    assert.match(
      renderPostgresMigration(plan([])).script,
      /-- No changes\.\n$/,
    );
  });

  it("keeps names with line breaks inside comments in the script", () => {
    const hostile = 'x\nDROP TABLE "victim"; --';
    const { script } = renderPostgresMigration({
      dialect: "postgresql",
      operations: [
        {
          operation: {
            kind: "drop-table",
            namespace: "app",
            tableName: hostile,
          },
          risk: "destructive",
          warnings: [],
        },
      ],
      unsupported: [{ object: hostile, reason: "test\r\nDROP TABLE victim;" }],
      questions: [],
    });
    const header = script.slice(0, script.indexOf("\n\n"));
    for (const line of header.split("\n"))
      assert.ok(line.startsWith("--"), `header line is not a comment: ${line}`);
    // The identifier itself stays quoted inside the statement.
    assert.ok(
      script.includes(`DROP TABLE "app"."x\nDROP TABLE ""victim""; --";`),
    );
  });

  it("rejects non-integer sequence values instead of rendering them", () => {
    const bad = sequence("s", { start: "1; DROP TABLE t" });
    assert.throws(() =>
      renderPostgresMigration(
        plan([{ kind: "create-sequence", namespace: "app", sequence: bad }]),
      ),
    );
  });

  it("refuses plans for another dialect", () => {
    const other = { ...plan([]), dialect: "mysql" } as unknown as MigrationPlan;
    assert.throws(() => renderPostgresMigration(other));
  });
});

describe("renderIndexDefinition", () => {
  it("quotes every name", () => {
    assert.equal(
      renderIndexDefinition({
        namespace: "app",
        tableName: "Order",
        name: 'odd"name',
        columns: ["customerId", "created at"],
        unique: true,
      }),
      `CREATE UNIQUE INDEX "odd""name" ON "app"."Order" USING btree ("customerId", "created at")`,
    );
    assert.throws(() =>
      renderIndexDefinition({
        namespace: "app",
        tableName: "t",
        name: "i",
        columns: [],
        unique: false,
      }),
    );
  });
});

describe("quoting", () => {
  it("quotes identifiers exactly", () => {
    assert.equal(quoteIdent("Order"), `"Order"`);
    assert.equal(quoteIdent("select"), `"select"`);
    assert.equal(quoteIdent('we"ird'), `"we""ird"`);
    assert.throws(() => quoteIdent(""));
    assert.throws(() => quoteIdent("a\0b"));
  });

  it("quotes literals like quote_literal", () => {
    assert.equal(quoteLiteral("plain"), `'plain'`);
    assert.equal(quoteLiteral("it's"), `'it''s'`);
    assert.equal(quoteLiteral("a\\b"), `E'a\\\\b'`);
    assert.equal(quoteLiteral("it's \\ ok"), `E'it''s \\\\ ok'`);
    assert.throws(() => quoteLiteral("a\0b"));
  });

  it("removes line breaks from comment text", () => {
    assert.equal(commentText("a\nb\r\nc"), "a b c");
  });
});
