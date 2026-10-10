// Runs only when SKEMATRON_TEST_DATABASE_URL points at a dedicated, disposable test database.
// Each test works inside its own random skematron_test_* schema and drops only that schema.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import pg from "pg";
import {
  emptySnapshot,
  isEmptyPlan,
  planMigration,
  snapshotChecksum,
  type MigrationPlan,
  type Operation,
  type SchemaSnapshot,
} from "@skematron/core";
import { introspectPostgres } from "./introspect.ts";
import { quoteIdent } from "./quote.ts";
import { renderPostgresMigration } from "./render.ts";

const databaseUrl = process.env.SKEMATRON_TEST_DATABASE_URL;
const SCHEMA_PREFIX = "skematron_test_";

describe(
  "PostgreSQL integration",
  {
    skip: databaseUrl
      ? false
      : "set SKEMATRON_TEST_DATABASE_URL to run the PostgreSQL integration tests",
  },
  () => {
    let client: pg.Client;
    let schema = "";

    before(async () => {
      client = new pg.Client({
        connectionString: databaseUrl,
        application_name: "skematron-tests",
      });
      await client.connect();
    });
    after(async () => {
      await client?.end();
    });
    beforeEach(async () => {
      schema = `${SCHEMA_PREFIX}${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      await client.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    });
    afterEach(async () => {
      await dropSchema();
    });

    async function dropSchema(): Promise<void> {
      assert.ok(
        schema.startsWith(SCHEMA_PREFIX),
        "refusing to drop a schema the test did not create",
      );
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    }

    async function recreateSchema(): Promise<void> {
      await dropSchema();
      await client.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    }

    async function load(fixture: "v1" | "v2" | "unsupported"): Promise<void> {
      const sql = await readFile(
        new URL(`./fixtures/${fixture}.sql`, import.meta.url),
        "utf8",
      );
      await client.query(sql.replaceAll("__SCHEMA__", quoteIdent(schema)));
    }

    async function introspect() {
      return introspectPostgres(client, { namespaces: [schema] });
    }

    /** Applies each rendered statement on its own, as an operator reviewing the plan would. */
    async function apply(
      from: SchemaSnapshot,
      to: SchemaSnapshot,
    ): Promise<MigrationPlan> {
      const plan = planMigration(from, to);
      for (const statement of renderPostgresMigration(plan).statements)
        await client.query(statement.sql);
      return plan;
    }

    it("introspects the supported objects of a schema", async () => {
      await load("v1");
      const { snapshot, unsupported } = await introspect();
      assert.deepEqual(unsupported, []);
      const [namespace] = snapshot.namespaces;
      assert.equal(namespace!.name, schema);
      assert.deepEqual(
        namespace!.tables.map((t) => t.name),
        ["customers", "legacy_notes", "orders"],
      );
      assert.deepEqual(namespace!.enums, [
        { name: "order_status", values: ["pending", "paid", "shipped"] },
      ]);

      const customers = namespace!.tables[0]!;
      assert.deepEqual(
        customers.columns.map((c) => c.name),
        ["id", "email", "name", "code", "created_at", "referred_by"],
      );
      assert.deepEqual(customers.columns[0], {
        name: "id",
        type: "integer",
        nullable: false,
        default: `nextval('${schema}.customers_id_seq'::regclass)`,
        identity: null,
        generated: null,
        collation: null,
        comment: null,
      });
      assert.equal(customers.columns[1]!.comment, "Login email, it's unique");
      assert.equal(customers.columns[3]!.collation, 'pg_catalog."C"');
      assert.equal(customers.comment, "People who place orders");
      assert.deepEqual(
        customers.foreignKeys.map((fk) => [
          fk.name,
          fk.onDelete,
          fk.deferrable,
        ]),
        [
          [
            "customers_referred_by_fkey",
            "set-null",
            "deferrable-initially-deferred",
          ],
        ],
      );
      assert.deepEqual(
        customers.indexes.map((i) => [i.name, i.unique]),
        [["customers_lower_email_idx", true]],
      );

      const orders = namespace!.tables[2]!;
      assert.equal(orders.columns[0]!.identity, "by-default");
      assert.equal(orders.columns[2]!.type, `${schema}.order_status`);
      assert.equal(orders.columns[5]!.generated?.kind, "stored");
      assert.deepEqual(orders.checkConstraints, [
        { name: "orders_quantity_check", expression: "(quantity > 0)" },
      ]);
      assert.match(
        orders.indexes.find((i) => i.name === "orders_open_idx")!.definition,
        /WHERE/,
      );

      assert.deepEqual(
        namespace!.sequences.map((s) => [
          s.name,
          s.start,
          s.increment,
          s.ownedBy,
        ]),
        [
          ["customers_id_seq", "1", "1", { table: "customers", column: "id" }],
          ["invoice_number_seq", "1000", "10", null],
        ],
      );
    });

    it("reports objects it does not capture", async () => {
      await load("unsupported");
      const { snapshot, unsupported } = await introspect();
      assert.deepEqual(
        snapshot.namespaces[0]!.tables.map((t) => t.name),
        ["accounts", "bookings"],
      );
      assert.deepEqual(snapshot.namespaces[0]!.tables[1]!.checkConstraints, []);
      assert.deepEqual(
        [...new Set(unsupported.map((o) => o.kind))],
        [
          "domain",
          "exclusion-constraint",
          "function",
          "materialized-view",
          "partition",
          "partitioned-table",
          "policy",
          "row-level-security",
          "trigger",
          "unlogged-table",
          "view",
        ],
      );
    });

    it("recreates a schema from its exported DDL with an identical checksum", async () => {
      await load("v1");
      const original = (await introspect()).snapshot;
      await dropSchema();
      await apply(emptySnapshot("postgresql"), original);
      const recreated = (await introspect()).snapshot;
      assert.equal(
        await snapshotChecksum(recreated),
        await snapshotChecksum(original),
      );
    });

    it("migrates v1 to a state equivalent to v2", async () => {
      await load("v2");
      const target = (await introspect()).snapshot;
      await recreateSchema();
      await load("v1");
      const source = (await introspect()).snapshot;

      const plan = await apply(source, target);
      assert.deepEqual(plan.unsupported, []);
      const kinds = new Set(
        plan.operations.map(({ operation }) => operation.kind),
      );
      const expected: Operation["kind"][] = [
        "add-enum-value",
        "alter-column-type",
        "drop-table",
        "create-table",
        "alter-column-identity",
        "set-not-null",
      ];
      for (const kind of expected)
        assert.ok(kinds.has(kind), `expected the plan to include ${kind}`);

      const migrated = (await introspect()).snapshot;
      assert.ok(
        isEmptyPlan(planMigration(migrated, target)),
        "migrated schema should be equivalent to v2",
      );
      // phone was appended rather than inserted mid-table: equivalent, but not byte-identical.
      const columnOrder = (s: SchemaSnapshot) =>
        s.namespaces[0]!.tables[0]!.columns.map((c) => c.name);
      assert.notDeepEqual(columnOrder(migrated), columnOrder(target));
    });

    it("marks the reverse migration's data loss as destructive and unsupported", async () => {
      await load("v1");
      const v1 = (await introspect()).snapshot;
      await recreateSchema();
      await load("v2");
      const v2 = (await introspect()).snapshot;

      const plan = planMigration(v2, v1);
      const destructive = plan.operations
        .filter((planned) => planned.risk === "destructive")
        .map(({ operation }) => operation.kind);
      assert.ok(destructive.includes("drop-table"));
      assert.ok(destructive.includes("drop-column"));
      assert.deepEqual(
        plan.unsupported.map((change) => change.object),
        [`${schema}.order_status`],
      );
    });
  },
);
