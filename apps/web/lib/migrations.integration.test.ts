// Integration tests for the shadow database, Prisma import and the migration workflow.
// Needs SKEMATRON_TEST_DATABASE_URL (metadata database, created per run) and
// SKEMATRON_SHADOW_DATABASE_URL (`pnpm db:start` sets up both locally).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { MigrationPlan, SchemaSnapshot } from "@skematron/core";
import { column, namespace, snapshot, table } from "@skematron/core/testing";
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

const fixture = (name: string) =>
  readFile(
    join(repositoryRoot, "packages/adapters/src/prisma/fixtures", name),
    "utf8",
  );

describe(
  "migrations",
  {
    skip:
      testUrl && shadowUrl
        ? false
        : "set SKEMATRON_TEST_DATABASE_URL and SKEMATRON_SHADOW_DATABASE_URL to run migration integration tests",
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
      drafts: typeof import("./schema-drafts.ts");
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
        drafts: await import("./schema-drafts.ts"),
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

    const project = () => lib.projects.getProject(actors.owner, "blog");

    async function shadowDatabases(): Promise<string[]> {
      const { rows } = await metadata.admin.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname LIKE 'skematron\\_shadow\\_%'",
      );
      return rows.map((row) => row.datname);
    }

    it("always drops the shadow database, also after a failure", async () => {
      const before = await shadowDatabases();
      let name = "";
      await lib.shadow.withShadowDatabase(async (client) => {
        const { rows } = await client.query<{
          name: string;
          superuser: string;
        }>(
          "SELECT current_database() AS name, current_setting('is_superuser') AS superuser",
        );
        name = rows[0]!.name;
        assert.equal(rows[0]!.superuser, "off");
      });
      assert.match(name, /^skematron_shadow_[0-9a-f]{16}$/);
      await assert.rejects(
        lib.shadow.withShadowDatabase(async () => {
          throw new Error("boom");
        }),
        /boom/,
      );
      assert.deepEqual(await shadowDatabases(), before);
    });

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

    it("imports a schema.prisma as a version through Prisma and the shadow database", async () => {
      const { importPrismaSchema } = lib.prisma;
      const { ForbiddenError } = lib.errors;
      const blog = await project();
      const v1 = await importPrismaSchema(
        actors.member,
        blog,
        await fixture("v1.prisma"),
      );
      assert.deepEqual(v1, { status: "created", number: 1, removed: ["url"] });
      const version = await lib.versions.getVersion(actors.viewer, blog, 1);
      const source = version.source as Record<string, string>;
      assert.equal(source.kind, "prisma-schema");
      assert.match(source.prismaVersion!, /^\d+\.\d+\.\d+/);
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
      assert.deepEqual(loaded.namespaces[0]!.enums, [
        { name: "Role", values: ["USER", "ADMIN"] },
      ]);

      assert.deepEqual(
        await importPrismaSchema(
          actors.member,
          blog,
          await fixture("v1.prisma"),
        ),
        { status: "unchanged", number: 1, removed: ["url"] },
      );
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
          error instanceof lib.errors.UserFacingError &&
          error.message.includes('Type "Strin"') &&
          error.message.includes("schema.prisma:7") &&
          !error.message.includes("skematron-prisma-"),
      );
      await assert.rejects(
        importPrismaSchema(
          actors.member,
          blog,
          'datasource db {\n  provider = "mysql"\n}\n',
        ),
        /uses "mysql"/,
      );
      const v2 = await importPrismaSchema(
        actors.member,
        blog,
        await fixture("v2.prisma"),
      );
      assert.equal(v2.number, 2);
      assert.deepEqual(await shadowDatabases(), []);
    });

    it("guides a migration through questions, verification and four-eyes review", async () => {
      const {
        createMigration,
        getMigration,
        latestRevision,
        loadRevision,
        reviewMigration,
        reviseMigration,
        submitMigration,
      } = lib.migrations;
      const { ForbiddenError } = lib.errors;
      const blog = await project();
      const reload = () => getMigration(actors.viewer, blog, 1);

      await assert.rejects(
        createMigration(actors.viewer, blog, { from: 1, to: 2, title: "" }),
        ForbiddenError,
      );
      const created = await createMigration(actors.admin, blog, {
        from: 1,
        to: 2,
        title: "",
      });
      assert.equal(created.number, 1);
      assert.equal(created.title, "v1 → v2");
      let migration = await reload();
      let revision = latestRevision(migration);
      assert.equal(revision.openQuestions, 2);
      assert.equal(revision.verification, "passed");
      const { plan } = await loadRevision(revision);
      const ids = plan.questions.map((question) => question.id);
      assert.deepEqual(ids, [
        '["rename-column","public","User","fullName"]',
        '["backfill","public","Post","slug"]',
      ]);

      await assert.rejects(
        submitMigration(actors.admin, blog, migration),
        /open questions/,
      );

      await reviseMigration(actors.admin, blog, migration, {
        [ids[0]!]: { choice: "rename", to: "displayName" },
        [ids[1]!]: { choice: "backfill", value: "untitled" },
      });
      migration = await reload();
      revision = latestRevision(migration);
      assert.equal(revision.number, 2);
      assert.equal(revision.openQuestions, 0);
      assert.equal(
        revision.verification,
        "passed",
        revision.verificationDetail ?? "",
      );
      const answered = await loadRevision(revision);
      assert.ok(
        answered.script.includes(
          'ALTER TABLE "public"."User" RENAME COLUMN "fullName" TO "displayName"',
        ),
      );
      assert.ok(answered.script.includes(`DEFAULT 'untitled'::text NOT NULL`));
      const summary = lib.migrations.summaryOf(revision);
      assert.equal(summary.destructive, 1, "Post.published is dropped");

      await submitMigration(actors.admin, blog, migration);
      migration = await reload();
      assert.equal(migration.status, "in_review");

      const approve = (actor: Actor, overrides = {}) =>
        reviewMigration(actor, blog, migration, {
          verdict: "approved",
          revisionId: revision.id,
          comment: "",
          acknowledgeDestructive: true,
          ...overrides,
        });
      await assert.rejects(approve(actors.member), ForbiddenError);
      await assert.rejects(approve(actors.viewer), ForbiddenError);
      await assert.rejects(approve(actors.admin), /migration you wrote/);
      await assert.rejects(
        approve(actors.owner, { acknowledgeDestructive: false }),
        /1 destructive operation/,
      );
      await assert.rejects(
        approve(actors.owner, { revisionId: migration.revisions[1]!.id }),
        /changed after you opened it/,
      );
      await approve(actors.owner);
      migration = await reload();
      assert.equal(migration.status, "approved");
      assert.equal(migration.reviews[0]!.revisionId, revision.id);
      assert.equal(migration.reviews[0]!.acknowledgedDestructive, true);

      // New content means a new revision, and the approval does not carry over.
      await reviseMigration(actors.member, blog, migration, {
        [ids[0]!]: { choice: "rename", to: "displayName" },
        [ids[1]!]: { choice: "backfill", value: "draft" },
      });
      migration = await reload();
      assert.equal(migration.status, "draft");
      assert.equal(latestRevision(migration).number, 3);
      await submitMigration(actors.member, blog, migration);
      migration = await reload();
      const reject = (comment: string) =>
        reviewMigration(actors.owner, blog, migration, {
          verdict: "rejected",
          revisionId: latestRevision(migration).id,
          comment,
          acknowledgeDestructive: false,
        });
      // The admin did not write revision 3, but did write the migration.
      await assert.rejects(
        reviewMigration(actors.admin, blog, migration, {
          verdict: "rejected",
          revisionId: latestRevision(migration).id,
          comment: "no",
          acknowledgeDestructive: false,
        }),
        /migration you wrote/,
      );
      await assert.rejects(reject("  "), /why you are rejecting/);
      await reject("Use a slug derived from the title instead.");
      migration = await reload();
      assert.equal(migration.status, "rejected");
      await assert.rejects(
        submitMigration(actors.admin, blog, migration),
        /Only a draft/,
      );

      // Every revision is still there, unchanged.
      assert.deepEqual(
        migration.revisions.map((r) => r.number),
        [3, 2, 1],
      );
      const audit = await lib.db.db().auditEvent.findMany({
        where: { targetId: migration.id },
        orderBy: { createdAt: "asc" },
      });
      assert.deepEqual(
        audit.map((event) => event.action),
        [
          "migration.create",
          "migration.revise",
          "migration.submit",
          "migration.approve",
          "migration.revise",
          "migration.submit",
          "migration.reject",
        ],
      );
    });

    it("records a failed verification and blocks submission", async () => {
      const blog = await project();
      const schemaWith = (type: string) =>
        snapshot(
          namespace("app", {
            tables: [table("t", { columns: [column("c", type)] })],
          }),
        );
      const from = await lib.versions.recordVersion(actors.admin, blog, {
        snapshot: schemaWith("text"),
        unsupported: [],
        source: { kind: "test" },
      });
      const to = await lib.versions.recordVersion(actors.admin, blog, {
        snapshot: schemaWith("integer"),
        unsupported: [],
        source: { kind: "test" },
      });
      const migration = await lib.migrations.createMigration(
        actors.admin,
        blog,
        {
          from: from.number,
          to: to.number,
          title: "Make c numeric",
        },
      );
      const loaded = await lib.migrations.getMigration(
        actors.admin,
        blog,
        migration.number,
      );
      const revision = lib.migrations.latestRevision(loaded);
      assert.equal(revision.verification, "failed");
      assert.match(
        revision.verificationDetail!,
        /Statement 1 of 1 failed: column "c" cannot be cast automatically/,
      );
      await assert.rejects(
        lib.migrations.submitMigration(actors.admin, blog, loaded),
        /shadow database check has not passed/,
      );

      // A plan that ran but did not reach the target is a failure too.
      const incomplete: MigrationPlan = {
        dialect: "postgresql",
        operations: [],
        unsupported: [],
        questions: [],
      };
      const result = await lib.shadow.verifyMigration({
        from: schemaWith("text"),
        fromUnsupported: [],
        plan: incomplete,
        to: schemaWith("integer"),
      });
      assert.equal(result.status, "failed");
      assert.deepEqual(await shadowDatabases(), []);
    });

    it("reads answers from the migration form", () => {
      const { answersFromForm } = lib.migrations;
      const id = '["rename-column","public","User","fullName"]';
      const backfill = '["backfill","public","Post","slug"]';
      assert.deepEqual(
        answersFromForm([
          [`answer:${id}`, "rename:displayName"],
          [`answer:${backfill}`, "backfill"],
          [`value:${backfill}`, "it's"],
          ["answer:__proto__", "drop"],
          ['answer:["x"]', ""],
          ["project", "blog"],
        ]),
        {
          [id]: { choice: "rename", to: "displayName" },
          [backfill]: { choice: "backfill", value: "it's" },
        },
      );
      assert.throws(
        () => answersFromForm([[`answer:${backfill}`, "backfill"]]),
        /Enter a value/,
      );
      assert.throws(
        () => answersFromForm([[`answer:${id}`, "maybe"]]),
        /unknown answer/,
      );
    });

    it("edits a dashboard schema through drafts that PostgreSQL normalizes", async () => {
      const { createProject, getProject, setSchemaSource } = lib.projects;
      const {
        startDraft,
        editDraft,
        saveDraft,
        getDraft,
        draftSnapshot,
        discardDraft,
      } = lib.drafts;
      const { ForbiddenError } = lib.errors;
      await createProject(actors.owner, "Shop", "dashboard");
      const shop = () => getProject(actors.owner, "shop");
      const products = { namespace: "public", table: "products" };

      await assert.rejects(
        startDraft(actors.viewer, await shop()),
        ForbiddenError,
      );
      await assert.rejects(
        startDraft(actors.member, await project()),
        /written in code/,
        "the editor is for dashboard projects only",
      );
      await assert.rejects(
        lib.prisma.importPrismaSchema(
          actors.member,
          await shop(),
          await fixture("v1.prisma"),
        ),
        /written in the dashboard/,
      );

      const draft = await startDraft(actors.member, await shop());
      assert.equal(draft.baseVersionId, null);
      await assert.rejects(
        saveDraft(actors.member, await shop()),
        /no changes/,
      );
      await editDraft(actors.member, await shop(), {
        kind: "add-table",
        namespace: "public",
        name: "products",
        idColumn: "id",
        idType: "bigint",
        identity: true,
      });
      for (const [name, type, extra] of [
        ["price", "numeric(10, 2)", { required: true, default: "0" }],
        ["sku", "varchar(40)", { unique: true }],
        ["stock", "int", {}],
      ] as const) {
        await editDraft(actors.member, await shop(), {
          kind: "add-column",
          table: products,
          name,
          type,
          required: false,
          default: "",
          unique: false,
          ...extra,
        });
      }
      await assert.rejects(
        editDraft(actors.member, await shop(), {
          kind: "add-column",
          table: products,
          name: "bad",
          type: "strng",
          required: false,
          default: "",
          unique: false,
        }),
        /PostgreSQL rejected the schema.*type "strng" does not exist/s,
      );
      await editDraft(actors.member, await shop(), {
        kind: "add-table",
        namespace: "public",
        name: "orders",
        idColumn: "id",
        idType: "bigint",
        identity: true,
      });
      const orders = { namespace: "public", table: "orders" };
      await editDraft(actors.member, await shop(), {
        kind: "add-column",
        table: orders,
        name: "product_id",
        type: "bigint",
        required: true,
        default: "",
        unique: false,
      });
      await editDraft(actors.member, await shop(), {
        kind: "add-foreign-key",
        table: orders,
        columns: ["product_id"],
        references: products,
        referencedColumns: [],
        onDelete: "restrict",
        name: "",
      });
      await editDraft(actors.member, await shop(), {
        kind: "add-index",
        table: orders,
        columns: ["product_id"],
        unique: false,
        name: "",
      });

      const edited = draftSnapshot(
        (await getDraft(actors.member, await shop()))!,
      );
      const [table] = edited.namespaces[0]!.tables.filter(
        (t) => t.name === "products",
      );
      assert.deepEqual(
        table!.columns.map((c) => [c.name, c.type, c.nullable, c.default]),
        [
          ["id", "bigint", false, null],
          ["price", "numeric(10,2)", false, "0"],
          ["sku", "character varying(40)", true, null],
          ["stock", "integer", true, null],
        ],
        "types and defaults are stored the way PostgreSQL prints them",
      );
      assert.deepEqual(
        table!.uniqueConstraints.map((u) => u.name),
        ["products_sku_key"],
      );
      const ordersTable = edited.namespaces[0]!.tables.find(
        (t) => t.name === "orders",
      )!;
      assert.equal(ordersTable.foreignKeys[0]!.name, "orders_product_id_fkey");
      assert.deepEqual(ordersTable.foreignKeys[0]!.references.columns, ["id"]);
      assert.match(
        ordersTable.indexes[0]!.definition,
        /^CREATE INDEX orders_product_id_idx ON public\.orders USING btree \(product_id\)$/,
      );

      assert.deepEqual(await saveDraft(actors.member, await shop()), {
        number: 1,
        baseNumber: null,
      });
      assert.equal(await getDraft(actors.member, await shop()), null);
      const v1 = await lib.versions.getVersion(actors.viewer, await shop(), 1);
      assert.deepEqual(v1.source, { kind: "dashboard", baseVersion: "none" });

      // Two drafts from v1: the second save would drop the first one's change, so it is refused.
      await startDraft(actors.member, await shop());
      await startDraft(actors.admin, await shop());
      await editDraft(actors.admin, await shop(), {
        kind: "add-column",
        table: products,
        name: "name",
        type: "text",
        required: true,
        default: "",
        unique: false,
      });
      await editDraft(actors.member, await shop(), {
        kind: "add-column",
        table: orders,
        name: "quantity",
        type: "integer",
        required: true,
        default: "1",
        unique: false,
      });
      assert.deepEqual(await saveDraft(actors.admin, await shop()), {
        number: 2,
        baseNumber: 1,
      });
      await assert.rejects(
        saveDraft(actors.member, await shop()),
        /Version 2 was saved after this draft started/,
      );
      await discardDraft(actors.member, await shop());

      // The saved versions migrate like any others, with the backfill question for products.name.
      const migration = await lib.migrations.createMigration(
        actors.member,
        await shop(),
        {
          from: 1,
          to: 2,
          title: "",
        },
      );
      const revision = lib.migrations.latestRevision(
        await lib.migrations.getMigration(
          actors.member,
          await shop(),
          migration.number,
        ),
      );
      assert.equal(
        revision.verification,
        "passed",
        revision.verificationDetail ?? "",
      );
      assert.equal(revision.openQuestions, 1);

      await assert.rejects(
        setSchemaSource(actors.member, await shop(), "code"),
        ForbiddenError,
      );
      await setSchemaSource(actors.owner, await shop(), "code");
      await assert.rejects(
        startDraft(actors.member, await shop()),
        /written in code/,
      );
      const audit = await lib.db.db().auditEvent.findMany({
        where: { action: "project.update" },
      });
      assert.deepEqual(
        audit.map((event) => event.details),
        [{ slug: "shop", schemaSource: "code" }],
      );
      assert.deepEqual(await shadowDatabases(), []);
    });
  },
);
