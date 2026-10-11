// Shared setup for the web app's integration tests (not used by the app). Each test file
// creates its own skematron_it_<random> database next to SKEMATRON_TEST_DATABASE_URL,
// migrates it with `prisma migrate deploy`, and drops it afterwards.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { Actor } from "./actor.ts";

export const repositoryRoot = join(import.meta.dirname, "../../..");

/** A URL for another database on the same server, in the form Prisma's engine accepts. */
export function siblingDatabaseUrl(url: string, database: string): string {
  const parsed = new URL(url);
  const socket = parsed.searchParams.get("host");
  const port = parsed.port || parsed.searchParams.get("port") || "5432";
  const user = parsed.username || process.env.USER || "postgres";
  const auth = parsed.password ? `${user}:${parsed.password}` : user;
  const host = parsed.hostname || "localhost";
  return `postgresql://${auth}@${host}:${port}/${database}${socket === null ? "" : `?host=${socket}`}`;
}

/**
 * Creates and migrates a metadata database, and points SKEMATRON_DATABASE_URL,
 * SKEMATRON_SECRET_KEY and SKEMATRON_ARTIFACT_DIR at test values. Import `db.ts`
 * only afterwards: it reads the URL once.
 */
export async function createTestMetadataDatabase(testUrl: string) {
  const database = `skematron_it_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const url = siblingDatabaseUrl(testUrl, database);
  assert.ok(
    url.includes(`/${database}`),
    "refusing to migrate anything but the test database",
  );
  process.env.SKEMATRON_DATABASE_URL = url;
  process.env.SKEMATRON_SECRET_KEY = randomBytes(32).toString("base64");
  const artifactDir = await mkdtemp(join(tmpdir(), "skematron-it-"));
  process.env.SKEMATRON_ARTIFACT_DIR = artifactDir;
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: repositoryRoot,
    env: { ...process.env, SKEMATRON_DATABASE_URL: url },
    stdio: "pipe",
  });
  return {
    admin,
    artifactDir,
    async drop(): Promise<void> {
      assert.ok(database.startsWith("skematron_it_"));
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
      await rm(artifactDir, { recursive: true, force: true });
    },
  };
}

type Prisma = ReturnType<typeof import("./db.ts").db>;

export async function createUser(prisma: Prisma, email: string) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      email,
      name: email.split("@")[0]!,
      emailVerified: false,
    },
  });
}

export async function createOrganization(
  prisma: Prisma,
  slug: string,
  owner: { id: string },
) {
  const organization = await prisma.organization.create({
    data: { id: randomUUID(), name: slug, slug, createdAt: new Date() },
  });
  const member = await prisma.member.create({
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

export const actorFor = (
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
