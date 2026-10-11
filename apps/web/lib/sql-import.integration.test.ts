// Integration tests for SQL import: real output of pg_dump, Drizzle, Knex, Django, Alembic
// and Prisma (packages/adapters/src/postgres/fixtures/scripts) runs in shadow databases,
// as the whole schema or as migrations on top of a version. Needs
// SKEMATRON_TEST_DATABASE_URL and SKEMATRON_SHADOW_DATABASE_URL (`pnpm db:start`).
// That shadow databases are always dropped is tested in branches.integration.test.ts.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  isEmptyPlan,
  planMigration,
  snapshotChecksum,
  type SchemaSnapshot,
} from "@skematron/core";
import type { Actor } from "./actor.ts";
import {
  actorFor,
  createOrganization,
  createTestMetadataDatabase,
  createUser,
  repositoryRoot,
} from "./test-support.ts";

const testUrl = process.env.SKEMATRON_TEST_DATABASE_URL;
const shadowUrl = process.env.SKEMATRON_SHADOW_DATABASE_URL;

const script = (name: string) =>
  readFile(
    join(
      repositoryRoot,
      "packages/adapters/src/postgres/fixtures/scripts",
      name,
    ),
    "utf8",
  );
const prismaFixture = (name: string) =>
  readFile(
    join(repositoryRoot, "packages/adapters/src/prisma/fixtures", name),
    "utf8",
  );

const tablesOf = (snapshot: SchemaSnapshot) =>
  snapshot.namespaces.map((namespace) => [
    namespace.name,
    namespace.tables.map((table) => table.name),
  ]);

const operationsOf = (from: SchemaSnapshot, to: SchemaSnapshot) =>
  planMigration(from, to).operations.map(({ operation }) => operation.kind);

describe(
  "SQL import",
  {
    skip:
      testUrl && shadowUrl
        ? false
        : "set SKEMATRON_TEST_DATABASE_URL and SKEMATRON_SHADOW_DATABASE_URL to run SQL import integration tests",
  },
  () => {
    let metadata: Awaited<ReturnType<typeof createTestMetadataDatabase>>;
    let lib: {
      db: typeof import("./db.ts");
      projects: typeof import("./projects.ts");
      versions: typeof import("./versions.ts");
      sql: typeof import("./sql-import.ts");
      prisma: typeof import("./prisma-import.ts");
      branches: typeof import("./branches.ts");
      errors: typeof import("./errors.ts");
    };
    const actors: Record<"owner" | "member" | "viewer", Actor> = {} as never;

    before(async () => {
      metadata = await createTestMetadataDatabase(testUrl!);
      lib = {
        db: await import("./db.ts"),
        projects: await import("./projects.ts"),
        versions: await import("./versions.ts"),
        sql: await import("./sql-import.ts"),
        prisma: await import("./prisma-import.ts"),
        branches: await import("./branches.ts"),
        errors: await import("./errors.ts"),
      };
      const prisma = lib.db.db();
      const owner = await createUser(prisma, "owner@example.com");
      const { organization } = await createOrganization(prisma, "acme", owner);
      actors.owner = actorFor(owner, organization.id, "owner");
      for (const role of ["member", "viewer"] as const) {
        const user = await createUser(prisma, `${role}@example.com`);
        actors[role] = actorFor(user, organization.id, role);
      }
    });

    after(async () => {
      await lib?.db.db().$disconnect();
      await metadata?.drop();
    });

    const whole = async (name: string) =>
      lib.sql.sqlSnapshot(await script(name), "schema");

    it("builds the same blog from every tool's whole-schema SQL", async () => {
      for (const name of [
        "pg-dump.sql",
        "drizzle-export.sql",
        "knex.sql",
        "django-0001.sql",
        "alembic-head.sql",
      ]) {
        const { snapshot } = await whole(name);
        assert.deepEqual(
          tablesOf(snapshot),
          [["public", ["posts", "users"]]],
          name,
        );
        const posts = snapshot.namespaces[0]!.tables[0]!;
        assert.deepEqual(
          posts.foreignKeys.map((foreignKey) => [
            foreignKey.columns,
            foreignKey.references.table,
          ]),
          [[["author_id"], "users"]],
          name,
        );
        assert.ok(
          posts.indexes.some((index) => index.definition.includes("author_id")),
          name,
        );
      }
    });

    it("gives a pg_dump the same snapshot as the database it came from", async () => {
      const dumped = await whole("pg-dump.sql");
      const original = await whole("pg-dump-source.sql");
      assert.equal(
        await snapshotChecksum(dumped.snapshot),
        await snapshotChecksum(original.snapshot),
      );
      assert.equal(
        await snapshotChecksum(dumped.snapshot),
        await snapshotChecksum((await whole("pg-dump.sql")).snapshot),
        "the same script gives the same snapshot",
      );
      const kinds = new Set(dumped.unsupported.map((object) => object.kind));
      for (const kind of [
        "extension",
        "view",
        "trigger",
        "migration-history",
      ]) {
        assert.ok(kinds.has(kind), `reports the ${kind}`);
      }
      assert.ok(
        dumped.unsupported.some(
          (object) =>
            object.kind === "migration-history" &&
            object.name === "schema_migrations",
        ),
      );
      assert.equal(dumped.source.kind, "sql-script");
      assert.equal(dumped.source.script, "schema");
      assert.match(dumped.source.scriptChecksum!, /^sha256:[0-9a-f]{64}$/);
      assert.deepEqual(
        [...new Set(dumped.skipped.map((statement) => statement.reason))],
        [
          "psql command",
          "time limit (Skematron's own limits apply)",
          "comment Skematron does not track",
          "ownership",
          "privileges",
        ],
      );
    });

    it("leaves migration history tables out, so every source compares as equal", async () => {
      const alembic = await whole("alembic-head.sql");
      assert.ok(
        alembic.unsupported.some(
          (object) =>
            object.kind === "migration-history" &&
            object.name === "alembic_version",
        ),
      );
      assert.deepEqual(tablesOf(alembic.snapshot), [
        ["public", ["posts", "users"]],
      ]);
    });

    it("applies migrations on top of the version they start from", async () => {
      for (const [first, next] of [
        ["django-0001.sql", "django-0002.sql"],
        ["alembic-head.sql", "alembic-0001-0002.sql"],
      ] as const) {
        const base = await whole(first);
        const changed = await lib.sql.sqlSnapshot(
          await script(next),
          "changes",
          { number: 1, ...base },
        );
        assert.deepEqual(operationsOf(base.snapshot, changed.snapshot), [
          "add-column",
        ]);
        assert.equal(changed.source.script, "changes");
        assert.equal(changed.source.onVersion, "1");
      }
    });

    it("gives a Prisma migration.sql the same result as the schema.prisma it came from", async () => {
      const base = await whole("prisma-v1.sql");
      const native = await lib.prisma.prismaSnapshot(
        await prismaFixture("v1.prisma"),
      );
      assert.equal(
        await snapshotChecksum(base.snapshot),
        await snapshotChecksum(native.snapshot),
      );
      const migrated = await lib.sql.sqlSnapshot(
        await script("prisma-v1-to-v2.sql"),
        "changes",
        { number: 1, ...base },
      );
      const v2 = await lib.prisma.prismaSnapshot(
        await prismaFixture("v2.prisma"),
      );
      // Equivalent, not identical: a migration adds columns at the end of a table, so
      // only their recorded positions differ, and planning ignores positions.
      assert.ok(isEmptyPlan(planMigration(migrated.snapshot, v2.snapshot)));
    });

    it("refuses scripts that cannot run, and names the statement that failed", async () => {
      const { UserFacingError } = lib.errors;
      const { sqlSnapshot } = lib.sql;
      await assert.rejects(sqlSnapshot("  \n", "schema"), /Upload or paste/);
      await assert.rejects(
        sqlSnapshot("-- only a comment\n", "schema"),
        /no SQL statements/,
      );
      await assert.rejects(
        sqlSnapshot("CREATE TABLE t (id int);\nCOPY t FROM stdin;", "schema"),
        (error: Error) =>
          error instanceof UserFacingError &&
          error.message.includes("Line 2: COPY"),
      );
      await assert.rejects(
        sqlSnapshot(
          "CREATE TABLE a (id int);\n\nCREATE TABLE b (id nonsense_type);",
          "schema",
        ),
        (error: Error) =>
          error instanceof UserFacingError &&
          error.message.includes("Statement 2 of 2 (line 3, CREATE TABLE b") &&
          error.message.includes('type "nonsense_type" does not exist'),
      );
      await assert.rejects(
        sqlSnapshot("ALTER TABLE missing ADD COLUMN a int;", "changes", {
          number: null,
          snapshot: { formatVersion: 1, dialect: "postgresql", namespaces: [] },
          unsupported: [],
        }),
        /relation "missing" does not exist/,
      );
    });

    it("rolls back a transaction the script leaves open, as psql does", async () => {
      const { snapshot } = await lib.sql.sqlSnapshot(
        "CREATE TABLE kept (id int);\nBEGIN;\nCREATE TABLE never_committed (id int);",
        "schema",
      );
      assert.deepEqual(tablesOf(snapshot), [["public", ["kept"]]]);
    });

    it("imports a SQL baseline, then takes migrations through a branch", async () => {
      const { ForbiddenError } = lib.errors;
      await lib.projects.createProject(actors.owner, "Shop");
      await lib.projects.createProject(actors.owner, "Notes", "dashboard");
      const shop = await lib.projects.getProject(actors.owner, "shop");
      const notes = await lib.projects.getProject(actors.owner, "notes");
      const first = await script("django-0001.sql");
      await assert.rejects(
        lib.sql.importSqlSchema(actors.viewer, shop, first),
        ForbiddenError,
      );
      await assert.rejects(
        lib.sql.importSqlSchema(actors.member, notes, first),
        /written in Skematron's editor/,
      );
      const v1 = await lib.sql.importSqlSchema(actors.member, shop, first);
      assert.equal(v1.number, 1);
      const version = await lib.versions.getVersion(actors.viewer, shop, 1);
      assert.equal(
        (version.source as Record<string, string>).kind,
        "sql-script",
      );
      await assert.rejects(
        lib.sql.importSqlSchema(actors.member, shop, first),
        /Main already has a version/,
      );

      await lib.branches.createBranch(actors.member, shop, {
        name: "post-summary",
      });
      const load = () =>
        lib.branches.getBranch(actors.viewer, shop, "post-summary");
      const next = await script("django-0002.sql");
      await assert.rejects(
        lib.branches.uploadSqlToBranch(
          actors.viewer,
          shop,
          await load(),
          next,
          "changes",
        ),
        ForbiddenError,
      );
      await lib.branches.uploadSqlToBranch(
        actors.member,
        shop,
        await load(),
        next,
        "changes",
      );
      // Uploading the same migration again replaces it: it applies to v1 again.
      await lib.branches.uploadSqlToBranch(
        actors.member,
        shop,
        await load(),
        next,
        "changes",
      );
      const branch = await load();
      assert.deepEqual(
        (await lib.branches.branchPlan(branch)).operations.map(
          ({ operation }) => operation.kind,
        ),
        ["add-column"],
      );
      assert.equal(
        (branch.headSource as Record<string, string>).script,
        "changes",
      );
    });

    it("leaves migration history tables out of database imports", async () => {
      const schema = `skematron_test_${randomBytes(6).toString("hex")}`;
      const testDb = new (await import("pg")).default.Client({
        connectionString: testUrl,
      });
      await testDb.connect();
      try {
        await testDb.query(
          `CREATE SCHEMA ${schema};
           CREATE TABLE ${schema}.accounts (id integer PRIMARY KEY);
           CREATE TABLE ${schema}._prisma_migrations (id varchar(36) PRIMARY KEY)`,
        );
        await lib.projects.createProject(actors.owner, "Ledger");
        const ledger = await lib.projects.getProject(actors.owner, "ledger");
        const environment = await lib.projects.createEnvironment(
          actors.owner,
          ledger,
          { name: "staging", connectionUrl: testUrl!, namespaces: [schema] },
        );
        assert.deepEqual(
          await lib.branches.importEnvironment(
            actors.member,
            ledger,
            environment,
          ),
          { kind: "version", number: 1 },
        );
        const version = await lib.versions.getVersion(actors.viewer, ledger, 1);
        assert.deepEqual(tablesOf(await lib.versions.loadSnapshot(version)), [
          [schema, ["accounts"]],
        ]);
        assert.ok(
          lib.versions
            .unsupportedOf(version)
            .some(
              (object) =>
                object.kind === "migration-history" &&
                object.name === "_prisma_migrations",
            ),
        );
      } finally {
        assert.ok(schema.startsWith("skematron_test_"));
        await testDb.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await testDb.end();
      }
    });
  },
);
