// Integration tests for the shadow database, Prisma import and the branch workflow:
// baseline, branches, questions, test runs, four-eyes review, merge, rebase and close.
// Needs SKEMATRON_TEST_DATABASE_URL (metadata database, created per run) and
// SKEMATRON_SHADOW_DATABASE_URL (`pnpm db:start` sets up both locally).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { SchemaSnapshot } from "@skematron/core";
import { snapshot } from "@skematron/core/testing";
import type { Actor } from "./actor.ts";
import {
  actorFor,
  createOrganization,
  createTestMetadataDatabase,
  createUser,
  repositoryRoot,
  siblingDatabaseUrl,
} from "./test-support.ts";

const testUrl = process.env.SKEMATRON_TEST_DATABASE_URL;
const shadowUrl = process.env.SKEMATRON_SHADOW_DATABASE_URL;

const fixture = (name: string) =>
  readFile(
    join(repositoryRoot, "packages/adapters/src/prisma/fixtures", name),
    "utf8",
  );

const RENAME = '["rename-column","public","User","fullName"]';
const BACKFILL = '["backfill","public","Post","slug"]';

describe(
  "branches",
  {
    skip:
      testUrl && shadowUrl
        ? false
        : "set SKEMATRON_TEST_DATABASE_URL and SKEMATRON_SHADOW_DATABASE_URL to run branch integration tests",
  },
  () => {
    let metadata: Awaited<ReturnType<typeof createTestMetadataDatabase>>;
    let lib: {
      db: typeof import("./db.ts");
      projects: typeof import("./projects.ts");
      versions: typeof import("./versions.ts");
      shadow: typeof import("./shadow.ts");
      prisma: typeof import("./prisma-import.ts");
      migrations: typeof import("./migrations.ts");
      branches: typeof import("./branches.ts");
      errors: typeof import("./errors.ts");
    };
    const actors: Record<"owner" | "admin" | "member" | "viewer", Actor> =
      {} as never;

    before(async () => {
      metadata = await createTestMetadataDatabase(testUrl!);
      lib = {
        db: await import("./db.ts"),
        projects: await import("./projects.ts"),
        versions: await import("./versions.ts"),
        shadow: await import("./shadow.ts"),
        prisma: await import("./prisma-import.ts"),
        migrations: await import("./migrations.ts"),
        branches: await import("./branches.ts"),
        errors: await import("./errors.ts"),
      };
      const prisma = lib.db.db();
      const owner = await createUser(prisma, "owner@example.com");
      const { organization } = await createOrganization(prisma, "acme", owner);
      actors.owner = actorFor(owner, organization.id, "owner");
      for (const role of ["admin", "member", "viewer"] as const) {
        const user = await createUser(prisma, `${role}@example.com`);
        actors[role] = actorFor(user, organization.id, role);
      }
      await lib.projects.createProject(actors.owner, "Blog");
    });

    after(async () => {
      await lib?.db.db().$disconnect();
      await metadata?.drop();
    });

    const project = (slug = "blog") =>
      lib.projects.getProject(actors.owner, slug);
    const branch = async (name: string, slug = "blog") =>
      lib.branches.getBranch(actors.viewer, await project(slug), name);

    async function shadowDatabases(): Promise<string[]> {
      const { rows } = await metadata.admin.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname LIKE 'skematron\\_shadow\\_%'",
      );
      return rows.map((row) => row.datname);
    }

    async function audit(targetId: string): Promise<string[]> {
      const events = await lib.db.db().auditEvent.findMany({
        where: { targetId },
        orderBy: { createdAt: "asc" },
      });
      return events.map((event) => event.action);
    }

    it("always drops the shadow database, also after a failure", async () => {
      // Other test files use shadow databases at the same time, so check these two by name.
      const used: string[] = [];
      const current = async (client: {
        query: (text: string) => Promise<{ rows: unknown[] }>;
      }) => {
        const { rows } = await client.query(
          "SELECT current_database() AS name, current_setting('is_superuser') AS superuser",
        );
        const row = rows[0] as { name: string; superuser: string };
        assert.equal(row.superuser, "off");
        used.push(row.name);
      };
      await lib.shadow.withShadowDatabase(current);
      await assert.rejects(
        lib.shadow.withShadowDatabase(async (client) => {
          await current(client);
          throw new Error("boom");
        }),
        /boom/,
      );
      assert.equal(used.length, 2);
      for (const name of used) {
        assert.match(name, /^skematron_shadow_[0-9a-f]{16}$/);
      }
      const left = await shadowDatabases();
      assert.deepEqual(
        used.filter((name) => left.includes(name)),
        [],
      );
    });

    const sameServer = (() => {
      if (!testUrl || !shadowUrl) return false;
      // A socket directory (?host=) wins over the host name; the port may be a parameter.
      const where = (url: string) => {
        const parsed = new URL(url);
        const host =
          parsed.searchParams.get("host") || parsed.hostname || "localhost";
        const port = parsed.port || parsed.searchParams.get("port") || "5432";
        return `${host}:${port}`;
      };
      return where(testUrl) === where(shadowUrl);
    })();

    it(
      "drops the shadow database once another role's session in it has ended",
      {
        skip: sameServer
          ? false
          : "needs the test and shadow databases on one server",
      },
      async () => {
        // Like an autovacuum worker: a session the shadow role may not terminate.
        let name = "";
        let other: InstanceType<typeof import("pg").default.Client> | undefined;
        await lib.shadow.withShadowDatabase(async (client) => {
          const { rows } = await client.query<{ name: string }>(
            "SELECT current_database() AS name",
          );
          name = rows[0]!.name;
          other = new (await import("pg")).default.Client({
            connectionString: siblingDatabaseUrl(testUrl!, name),
          });
          await other.connect();
          setTimeout(() => void other!.end(), 600);
        });
        assert.ok(!(await shadowDatabases()).includes(name));
      },
    );

    it("reports a missing shadow database instead of failing", async () => {
      const saved = process.env.SKEMATRON_SHADOW_DATABASE_URL;
      delete process.env.SKEMATRON_SHADOW_DATABASE_URL;
      try {
        const empty: SchemaSnapshot = snapshot();
        const result = await lib.shadow.verifyMigration({
          from: empty,
          fromUnsupported: [],
          plan: {
            dialect: "postgresql",
            operations: [],
            unsupported: [],
            questions: [],
          },
          to: empty,
        });
        assert.equal(result.status, "unavailable");
        await assert.rejects(
          lib.prisma.importPrismaSchema(
            actors.member,
            await project(),
            await fixture("v1.prisma"),
          ),
          /shadow database is not available/,
        );
      } finally {
        process.env.SKEMATRON_SHADOW_DATABASE_URL = saved;
      }
    });

    it("imports the first schema.prisma as the baseline, then only through branches", async () => {
      const { importPrismaSchema } = lib.prisma;
      const { ForbiddenError, UserFacingError } = lib.errors;
      const blog = await project();
      await assert.rejects(
        importPrismaSchema(actors.viewer, blog, await fixture("v1.prisma")),
        ForbiddenError,
      );
      await assert.rejects(
        importPrismaSchema(
          actors.member,
          blog,
          'datasource db {\n  provider = "postgresql"\n}\n\nmodel A {\n  id Int @id\n  b Strin\n}\n',
        ),
        (error: Error) =>
          error instanceof UserFacingError &&
          error.message.includes('Type "Strin"') &&
          error.message.includes("schema.prisma:7") &&
          !error.message.includes("skematron-prisma-"),
      );
      const v1 = await importPrismaSchema(
        actors.member,
        blog,
        await fixture("v1.prisma"),
      );
      assert.deepEqual(v1, { status: "created", number: 1, removed: ["url"] });
      const version = await lib.versions.getVersion(actors.viewer, blog, 1);
      const source = version.source as Record<string, string>;
      assert.equal(source.kind, "prisma-schema");
      const stored = new TextDecoder().decode(
        await lib.versions.artifacts().get(source.schemaChecksum!),
      );
      assert.ok(stored.includes("model User"));
      assert.ok(
        !stored.includes("DATABASE_URL"),
        "connection URLs are removed",
      );
      const loaded = await lib.versions.loadSnapshot(version);
      assert.deepEqual(
        loaded.namespaces.map((ns) => [ns.name, ns.tables.map((t) => t.name)]),
        [["public", ["Post", "User"]]],
      );
      await assert.rejects(
        importPrismaSchema(actors.member, blog, await fixture("v2.prisma")),
        /Start a branch/,
        "after the baseline, changes go through branches",
      );
    });

    it("takes a branch through questions, a test run, four-eyes review and merge", async () => {
      const {
        createBranch,
        uploadPrismaToBranch,
        testBranch,
        submitBranch,
        reviewBranch,
        mergeBranch,
        branchPlan,
        testedRevision,
      } = lib.branches;
      const { ForbiddenError } = lib.errors;
      const blog = await project();

      await assert.rejects(
        createBranch(actors.viewer, blog, { name: "nope" }),
        ForbiddenError,
      );
      await assert.rejects(
        createBranch(actors.member, blog, { name: "Not A Name!" }),
        /lowercase letters/,
      );
      const created = await createBranch(actors.member, blog, {
        name: "add-comments",
      });
      assert.equal(created.status, "open");
      await assert.rejects(
        createBranch(actors.admin, blog, { name: "add-comments" }),
        /already exists/,
      );
      let current = await branch("add-comments");
      assert.equal(current.baseVersion?.number, 1);
      assert.equal((await branchPlan(current)).operations.length, 0);
      await assert.rejects(
        submitBranch(actors.member, blog, current),
        /Run the test/,
      );

      const { removed } = await uploadPrismaToBranch(
        actors.member,
        blog,
        current,
        await fixture("v2.prisma"),
      );
      assert.deepEqual(removed, ["url"]);
      await assert.rejects(
        uploadPrismaToBranch(
          actors.admin,
          blog,
          current,
          await fixture("v2.prisma"),
        ),
        /changed while you were working/,
        "a second change from the same stale page is refused",
      );
      current = await branch("add-comments");
      const plan = await branchPlan(current);
      assert.deepEqual(
        plan.questions.map((question) => question.id),
        [RENAME, BACKFILL],
      );
      assert.deepEqual(
        await lib.versions
          .listVersions(actors.viewer, blog)
          .then((v) => v.length),
        1,
        "nothing is added to main while the branch is open",
      );

      await testBranch(actors.member, blog, current, null);
      current = await branch("add-comments");
      assert.equal(testedRevision(current)?.openQuestions, 2);
      await assert.rejects(
        submitBranch(actors.member, blog, current),
        /open questions/,
      );
      await testBranch(actors.member, blog, current, {
        [RENAME]: { choice: "rename", to: "displayName" },
        [BACKFILL]: { choice: "backfill", value: "untitled" },
      });
      current = await branch("add-comments");
      const tested = testedRevision(current)!;
      assert.equal(tested.openQuestions, 0);
      assert.equal(
        tested.verification,
        "passed",
        tested.verificationDetail ?? "",
      );
      const { script } = await lib.migrations.loadRevision(tested);
      assert.ok(
        script.includes(
          'ALTER TABLE "public"."User" RENAME COLUMN "fullName" TO "displayName"',
        ),
      );

      await submitBranch(actors.member, blog, current);
      current = await branch("add-comments");
      assert.equal(current.migration?.status, "in_review");
      const approve = (actor: Actor, overrides = {}) =>
        reviewBranch(actor, blog, current, {
          verdict: "approved",
          revisionId: tested.id,
          comment: "",
          acknowledgeDestructive: true,
          ...overrides,
        });
      await assert.rejects(approve(actors.viewer), ForbiddenError);
      await assert.rejects(approve(actors.member), ForbiddenError);
      // The admin uploaded once (refused above), so they did not change the branch.
      await assert.rejects(
        mergeBranch(actors.member, blog, current),
        /once its changes are approved/,
      );
      await assert.rejects(
        approve(actors.owner, { acknowledgeDestructive: false }),
        /1 destructive operation/,
      );
      await approve(actors.owner);
      current = await branch("add-comments");
      assert.equal(current.migration?.status, "approved");

      const merged = await mergeBranch(actors.member, blog, current);
      assert.deepEqual(merged, { number: 2 });
      current = await branch("add-comments");
      assert.equal(current.status, "merged");
      assert.equal(current.mergedVersion?.number, 2);
      const v2 = await lib.versions.getVersion(actors.viewer, blog, 2);
      const source = v2.source as Record<string, string>;
      assert.equal(source.kind, "branch");
      assert.equal(source.branch, "add-comments");
      assert.equal(source.via, "prisma-schema");
      assert.equal(source.baseVersion, "1");
      await assert.rejects(
        uploadPrismaToBranch(
          actors.member,
          blog,
          current,
          await fixture("v1.prisma"),
        ),
        /merged, so it can no longer change/,
      );
      assert.deepEqual(await audit(current.id), [
        "branch.create",
        "branch.update",
        "branch.merge",
      ]);
      assert.deepEqual(await audit(current.migration!.id), [
        "migration.revise",
        "migration.revise",
        "migration.submit",
        "migration.approve",
      ]);
    });

    it("keeps people who changed a branch from reviewing it", async () => {
      const {
        createBranch,
        uploadPrismaToBranch,
        testBranch,
        submitBranch,
        reviewBranch,
      } = lib.branches;
      const blog = await project();
      // The admin starts the branch, the member changes it; neither may approve.
      await createBranch(actors.admin, blog, { name: "team-work" });
      let current = await branch("team-work");
      await uploadPrismaToBranch(
        actors.member,
        blog,
        current,
        await fixture("v1.prisma"),
      );
      current = await branch("team-work");
      await testBranch(actors.member, blog, current, {
        '["rename-column","public","User","displayName"]': {
          choice: "rename",
          to: "fullName",
        },
      });
      current = await branch("team-work");
      const tested = lib.branches.testedRevision(current)!;
      assert.equal(
        tested.verification,
        "passed",
        tested.verificationDetail ?? "",
      );
      await submitBranch(actors.member, blog, current);
      current = await branch("team-work");
      await assert.rejects(
        reviewBranch(actors.admin, blog, current, {
          verdict: "approved",
          revisionId: tested.id,
          comment: "",
          acknowledgeDestructive: true,
        }),
        /changes you wrote/,
      );
      await reviewBranch(actors.owner, blog, current, {
        verdict: "rejected",
        revisionId: tested.id,
        comment: "We keep the new model.",
        acknowledgeDestructive: false,
      });
      current = await branch("team-work");
      assert.equal(current.migration?.status, "rejected");
      await lib.branches.closeBranch(actors.member, blog, current);
      current = await branch("team-work");
      assert.equal(current.status, "closed");
      assert.equal(
        (await lib.versions.listVersions(actors.viewer, blog)).length,
        2,
        "closing records nothing on main",
      );
    });

    it("refuses to merge a branch that main has moved past, until it is rebased", async () => {
      const {
        createBranch,
        uploadPrismaToBranch,
        testBranch,
        submitBranch,
        reviewBranch,
        mergeBranch,
        rebaseBranch,
      } = lib.branches;
      await lib.projects.createProject(actors.owner, "Shop", "dashboard");
      const shop = await project("shop");
      await createBranch(actors.member, shop, { name: "products" });
      let first = await branch("products", "shop");
      await lib.branches.editBranch(actors.member, shop, first, {
        kind: "add-table",
        namespace: "public",
        name: "products",
        idColumn: "id",
        idType: "bigint",
        identity: true,
      });
      await assert.rejects(
        uploadPrismaToBranch(
          actors.member,
          shop,
          await branch("products", "shop"),
          await fixture("v1.prisma"),
        ),
        /written in Skematron's editor/,
      );
      const finish = async (name: string) => {
        let current = await branch(name, "shop");
        await testBranch(actors.member, shop, current, null);
        current = await branch(name, "shop");
        await submitBranch(actors.member, shop, current);
        current = await branch(name, "shop");
        await reviewBranch(actors.owner, shop, current, {
          verdict: "approved",
          revisionId: lib.branches.testedRevision(current)!.id,
          comment: "",
          acknowledgeDestructive: true,
        });
        return branch(name, "shop");
      };
      // Two branches from the same (empty) main.
      await createBranch(actors.member, shop, { name: "orders" });
      await lib.branches.editBranch(
        actors.member,
        shop,
        await branch("orders", "shop"),
        {
          kind: "add-table",
          namespace: "public",
          name: "orders",
          idColumn: "id",
          idType: "int",
          identity: true,
        },
      );
      first = await finish("products");
      assert.deepEqual(await mergeBranch(actors.member, shop, first), {
        number: 1,
      });
      let second = await finish("orders");
      await assert.rejects(
        mergeBranch(actors.member, shop, second),
        /Main moved on to v1/,
      );
      second = await branch("orders", "shop");
      assert.deepEqual(await rebaseBranch(actors.member, shop, second), {
        number: 1,
      });
      second = await branch("orders", "shop");
      assert.equal(
        second.migration?.status,
        "draft",
        "a rebase needs a new review",
      );
      assert.equal(lib.branches.testedRevision(second), null, "and a new test");
      // Against v1, the branch would now drop products: the list shows it.
      const plan = await lib.branches.branchPlan(second);
      assert.ok(
        plan.operations.some(
          ({ operation }) =>
            operation.kind === "drop-table" &&
            operation.tableName === "products",
        ),
      );
      const head = lib.branches.headOf(second);
      assert.deepEqual(
        head.namespaces[0]!.tables.map((t) => [t.name, t.columns[0]!.type]),
        [["orders", "integer"]],
        "the editor's int was stored as PostgreSQL prints it",
      );
    });

    it("records a failed test run and blocks submission", async () => {
      await lib.projects.createProject(actors.owner, "Typed");
      const typed = await project("typed");
      const schema = (type: string) =>
        `datasource db {\n  provider = "postgresql"\n}\n\nmodel Item {\n  id Int @id\n  code ${type}\n}\n`;
      await lib.prisma.importPrismaSchema(
        actors.member,
        typed,
        schema("String"),
      );
      await lib.branches.createBranch(actors.member, typed, {
        name: "numeric-code",
      });
      await lib.branches.uploadPrismaToBranch(
        actors.member,
        typed,
        await branch("numeric-code", "typed"),
        schema("Int"),
      );
      const current = await branch("numeric-code", "typed");
      await lib.branches.testBranch(actors.member, typed, current, null);
      const tested = lib.branches.testedRevision(
        await branch("numeric-code", "typed"),
      )!;
      assert.equal(tested.verification, "failed");
      assert.match(
        tested.verificationDetail!,
        /Statement 1 of 1 failed: column "code" cannot be cast automatically/,
      );
      await assert.rejects(
        lib.branches.submitBranch(
          actors.member,
          typed,
          await branch("numeric-code", "typed"),
        ),
        /test run has not passed/,
      );
    });

    it("imports a database as the baseline, then turns differences into branches", async () => {
      const schema = `skematron_test_${randomBytes(6).toString("hex")}`;
      const testDb = new (await import("pg")).default.Client({
        connectionString: testUrl,
      });
      await testDb.connect();
      try {
        await testDb.query(
          `CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.accounts (id integer PRIMARY KEY)`,
        );
        await lib.projects.createProject(actors.owner, "Ledger");
        const ledger = await project("ledger");
        const environment = await lib.projects.createEnvironment(
          actors.owner,
          ledger,
          { name: "staging", connectionUrl: testUrl!, namespaces: [schema] },
        );
        const { importEnvironment } = lib.branches;
        assert.deepEqual(
          await importEnvironment(actors.member, ledger, environment),
          { kind: "version", number: 1 },
        );
        assert.deepEqual(
          await importEnvironment(actors.member, ledger, environment),
          { kind: "unchanged", number: 1 },
        );
        await testDb.query(
          `ALTER TABLE ${schema}.accounts ADD COLUMN email text`,
        );
        assert.deepEqual(
          await importEnvironment(actors.member, ledger, environment),
          { kind: "branch", name: "from-staging" },
        );
        assert.deepEqual(
          await importEnvironment(actors.member, ledger, environment),
          { kind: "branch", name: "from-staging-2" },
        );
        const imported = await branch("from-staging", "ledger");
        assert.equal(imported.baseVersion?.number, 1);
        assert.deepEqual(
          (await lib.branches.branchPlan(imported)).operations.map(
            ({ operation }) => operation.kind,
          ),
          ["add-column"],
        );
        assert.equal(
          (await lib.versions.listVersions(actors.viewer, ledger)).length,
          1,
          "a database import after the baseline adds nothing to main by itself",
        );
      } finally {
        assert.ok(schema.startsWith("skematron_test_"));
        await testDb.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await testDb.end();
      }
    });

    it("reads answers from the form", () => {
      const { answersFromForm } = lib.migrations;
      assert.deepEqual(
        answersFromForm([
          [`answer:${RENAME}`, "rename:displayName"],
          [`answer:${BACKFILL}`, "backfill"],
          [`value:${BACKFILL}`, "it's"],
          ["answer:__proto__", "drop"],
          ['answer:["x"]', ""],
          ["project", "blog"],
        ]),
        {
          [RENAME]: { choice: "rename", to: "displayName" },
          [BACKFILL]: { choice: "backfill", value: "it's" },
        },
      );
      assert.throws(
        () => answersFromForm([[`answer:${BACKFILL}`, "backfill"]]),
        /Enter a value/,
      );
      assert.throws(
        () => answersFromForm([[`answer:${RENAME}`, "maybe"]]),
        /unknown answer/,
      );
    });
  },
);
