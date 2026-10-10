// Integration tests for the metadata layer against a real PostgreSQL. Each run creates its
// own skematron_it_<random> database next to SKEMATRON_TEST_DATABASE_URL, applies the Prisma
// migrations, and drops it afterwards. Better Auth rows are created directly with Prisma.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { snapshotChecksum } from "@skematron/core";
import { column, namespace, snapshot, table } from "@skematron/core/testing";
import type { Actor } from "./actor.ts";

const testUrl = process.env.SKEMATRON_TEST_DATABASE_URL;
const repositoryRoot = join(import.meta.dirname, "../../..");

/** A URL for another database on the same server, in the form Prisma's engine accepts. */
function siblingDatabaseUrl(url: string, database: string): string {
  const parsed = new URL(url);
  const socket = parsed.searchParams.get("host");
  const port = parsed.port || parsed.searchParams.get("port") || "5432";
  const user = parsed.username || process.env.USER || "postgres";
  const auth = parsed.password ? `${user}:${parsed.password}` : user;
  const host = parsed.hostname || "localhost";
  return `postgresql://${auth}@${host}:${port}/${database}${socket === null ? "" : `?host=${socket}`}`;
}

describe(
  "metadata database",
  {
    skip: testUrl
      ? false
      : "set SKEMATRON_TEST_DATABASE_URL to run metadata integration tests",
  },
  () => {
    const database = `skematron_it_${randomBytes(6).toString("hex")}`;
    let admin: pg.Client;
    let artifactDir = "";
    let lib: {
      db: typeof import("./db.ts");
      membership: typeof import("./membership.ts");
      projects: typeof import("./projects.ts");
      versions: typeof import("./versions.ts");
      errors: typeof import("./errors.ts");
    };

    before(async () => {
      admin = new pg.Client({ connectionString: testUrl });
      await admin.connect();
      await admin.query(`CREATE DATABASE ${database}`);
      const url = siblingDatabaseUrl(testUrl!, database);
      assert.ok(
        url.includes(`/${database}`),
        "refusing to migrate anything but the test database",
      );
      process.env.SKEMATRON_DATABASE_URL = url;
      process.env.SKEMATRON_SECRET_KEY = randomBytes(32).toString("base64");
      artifactDir = await mkdtemp(join(tmpdir(), "skematron-it-"));
      process.env.SKEMATRON_ARTIFACT_DIR = artifactDir;
      execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
        cwd: repositoryRoot,
        env: { ...process.env, SKEMATRON_DATABASE_URL: url },
        stdio: "pipe",
      });
      lib = {
        db: await import("./db.ts"),
        membership: await import("./membership.ts"),
        projects: await import("./projects.ts"),
        versions: await import("./versions.ts"),
        errors: await import("./errors.ts"),
      };
    });

    after(async () => {
      await lib?.db.db().$disconnect();
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
      await rm(artifactDir, { recursive: true, force: true });
    });

    const prisma = () => lib.db.db();

    async function createUser(email: string) {
      return prisma().user.create({
        data: {
          id: randomUUID(),
          email,
          name: email.split("@")[0]!,
          emailVerified: false,
        },
      });
    }

    async function createOrganization(slug: string, owner: { id: string }) {
      const organization = await prisma().organization.create({
        data: { id: randomUUID(), name: slug, slug, createdAt: new Date() },
      });
      const member = await prisma().member.create({
        data: {
          id: randomUUID(),
          organizationId: organization.id,
          userId: owner.id,
          role: "owner",
          createdAt: new Date(),
        },
      });
      return { organization, member };
    }

    const actorFor = (
      user: { id: string; email: string },
      organizationId: string,
      role: Actor["role"],
    ): Actor => ({
      userId: user.id,
      name: user.email,
      email: user.email,
      organizationId,
      memberId: randomUUID(),
      role,
    });

    let ownerActor: Actor;
    let viewerActor: Actor;

    it("allows sign-up for the pending owner, then only for invited emails", async () => {
      const { maySignUp, INSTALLATION_ID } = lib.membership;
      assert.equal(
        await maySignUp("anyone@example.com"),
        false,
        "no installation yet",
      );

      await prisma().installation.create({
        data: {
          id: INSTALLATION_ID,
          status: "pending",
          ownerEmail: "owner@example.com",
        },
      });
      assert.equal(await maySignUp("Owner@Example.com"), true);
      assert.equal(await maySignUp("someone@example.com"), false);

      const owner = await createUser("owner@example.com");
      const { organization } = await createOrganization("acme", owner);
      await prisma().installation.update({
        where: { id: INSTALLATION_ID },
        data: { status: "complete", organizationId: organization.id },
      });
      ownerActor = actorFor(owner, organization.id, "owner");
      assert.equal(await maySignUp("viewer@example.com"), false, "not invited");

      const inviteFor = (
        email: string,
        expiresAt: Date,
        organizationId = organization.id,
      ) =>
        prisma().invitation.create({
          data: {
            id: randomUUID(),
            organizationId,
            email,
            role: "viewer",
            status: "pending",
            expiresAt,
            inviterId: owner.id,
          },
        });
      await inviteFor("viewer@example.com", new Date(Date.now() + 86_400_000));
      await inviteFor("late@example.com", new Date(Date.now() - 1000));
      const other = await createOrganization(
        "other",
        await createUser("x@example.com"),
      );
      await inviteFor(
        "elsewhere@example.com",
        new Date(Date.now() + 86_400_000),
        other.organization.id,
      );

      assert.equal(await maySignUp("VIEWER@example.com"), true);
      assert.equal(await maySignUp("late@example.com"), false, "expired");
      assert.equal(
        await maySignUp("elsewhere@example.com"),
        false,
        "another organization",
      );
    });

    it("joins an invitation once, with its role, and only for the invited email", async () => {
      const { acceptInvitation, InvitationError } = lib.membership;
      const invitation = await prisma().invitation.findFirstOrThrow({
        where: { email: "viewer@example.com" },
      });
      const viewer = await createUser("viewer@example.com");
      await assert.rejects(
        acceptInvitation(invitation.id, {
          id: viewer.id,
          email: "wrong@example.com",
        }),
        InvitationError,
      );
      const joined = await acceptInvitation(invitation.id, viewer);
      assert.equal(joined.role, "viewer");
      const member = await prisma().member.findFirstOrThrow({
        where: { userId: viewer.id },
      });
      assert.equal(member.role, "viewer");
      await assert.rejects(
        acceptInvitation(invitation.id, viewer),
        InvitationError,
        "already used",
      );
      viewerActor = actorFor(viewer, ownerActor.organizationId, "viewer");
    });

    it("stores connections only encrypted and scopes projects to the organization", async () => {
      const { createProject, createEnvironment, getProject } = lib.projects;
      const { ForbiddenError, NotFoundError } = lib.errors;
      const project = await createProject(ownerActor, "Billing API");
      assert.equal(project.slug, "billing-api");
      const environment = await createEnvironment(ownerActor, project, {
        name: "production",
        connectionUrl:
          "postgresql://app:SuperSecret123@db.invalid:5432/billing",
        namespaces: ["public", "billing"],
      });
      assert.ok(!environment.connectionCiphertext.includes("SuperSecret123"));
      assert.equal(
        environment.connectionHint,
        "postgresql://app@db.invalid:5432/billing",
      );
      const audit = await prisma().auditEvent.findMany({
        where: { targetId: environment.id },
      });
      assert.equal(audit.length, 1);
      assert.ok(!JSON.stringify(audit[0]!.details).includes("SuperSecret123"));

      await assert.rejects(createProject(viewerActor, "Nope"), ForbiddenError);
      const outsider = actorFor(
        await createUser("outsider@example.com"),
        randomUUID(),
        "owner",
      );
      await assert.rejects(getProject(outsider, "billing-api"), NotFoundError);
    });

    it("numbers versions sequentially, skips unchanged imports and verifies artifacts", async () => {
      const { recordVersion, loadSnapshot, listVersions } = lib.versions;
      const project = await lib.projects.getProject(ownerActor, "billing-api");
      const schemaWith = (columnName: string) =>
        snapshot(
          namespace("public", {
            tables: [table("t", { columns: [column(columnName, "integer")] })],
          }),
        );
      const source = { kind: "test" };

      const results = await Promise.all(
        ["a", "b", "c", "d", "e"].map((name) =>
          recordVersion(ownerActor, project, {
            snapshot: schemaWith(name),
            unsupported: [],
            source,
          }),
        ),
      );
      assert.deepEqual(
        results.map((result) => result.number).sort((x, y) => x - y),
        [1, 2, 3, 4, 5],
      );
      assert.ok(results.every((result) => result.status === "created"));

      const latest = (await listVersions(ownerActor, project))[0]!;
      const unchanged = await recordVersion(ownerActor, project, {
        snapshot: await loadSnapshot(latest),
        unsupported: [],
        source,
      });
      assert.deepEqual(unchanged, { status: "unchanged", number: 5 });

      assert.equal(
        await snapshotChecksum(await loadSnapshot(latest)),
        latest.checksum,
      );
      const files = await readdir(artifactDir, { recursive: true });
      const hex = latest.checksum.slice("sha256:".length);
      const file = files.find((name) => name.endsWith(hex))!;
      await writeFile(join(artifactDir, file), "tampered");
      await assert.rejects(loadSnapshot(latest), /checksum/);
    });
  },
);
