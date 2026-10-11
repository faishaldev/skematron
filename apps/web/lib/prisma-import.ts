// Prisma Schema import: a `schema.prisma` becomes a schema version through Prisma itself.
// `prisma migrate diff --from-empty` turns the schema into DDL, the DDL runs in a fresh
// shadow database, and introspecting that database gives the snapshot. Skematron never
// parses models, so the result is exactly what Prisma would create.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { preparePrismaSchema } from "@skematron/adapters";
import type { Actor } from "./actor.ts";
import { UserFacingError } from "./errors.ts";
import { assertCan, requireSchemaSource, type Project } from "./projects.ts";
import { snapshotFromDdl } from "./shadow.ts";
import {
  artifacts,
  listVersions,
  recordVersion,
  type ImportResult,
} from "./versions.ts";

export const MAX_PRISMA_SCHEMA_BYTES = 512 * 1024;
const PRISMA_TIMEOUT_MS = 60_000;

// Satisfies Prisma 7's config loader. `migrate diff --from-empty --to-schema` never
// connects, and this address (port 1 on loopback) could not be reached anyway.
const PRISMA_CONFIG = `export default { datasource: { url: "postgresql://skematron@127.0.0.1:1/unused" } };\n`;

const run = promisify(execFile);

/** The Prisma CLI installed with the app (a dependency of @skematron/web). */
async function findPrismaCli(): Promise<{ entry: string; version: string }> {
  // A filesystem walk instead of require.resolve, which bundlers rewrite.
  let directory = process.cwd();
  for (;;) {
    const root = join(directory, "node_modules", "prisma");
    try {
      const manifest = JSON.parse(
        await readFile(join(root, "package.json"), "utf8"),
      ) as { version: string; bin: { prisma: string } };
      return {
        entry: join(root, manifest.bin.prisma),
        version: manifest.version,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new UserFacingError(
        "The Prisma CLI is not installed on the server; reinstall Skematron's dependencies.",
      );
    }
    directory = parent;
  }
}

/** Prisma's message without the temporary directory or config noise. */
function prismaMessage(output: string, directory: string): string {
  const message = output
    .split("\n")
    .filter((line) => !line.startsWith("Loaded Prisma config"))
    .join("\n")
    .replaceAll(`${directory}/`, "")
    .trim();
  return message.length > 4000 ? `${message.slice(0, 4000)}…` : message;
}

/** Runs `prisma migrate diff --from-empty --to-schema` and returns the DDL. */
async function prismaDdl(
  schema: string,
): Promise<{ ddl: string; prismaVersion: string }> {
  const cli = await findPrismaCli();
  const directory = await mkdtemp(join(tmpdir(), "skematron-prisma-"));
  try {
    await writeFile(join(directory, "schema.prisma"), schema, { mode: 0o600 });
    await writeFile(join(directory, "prisma.config.mjs"), PRISMA_CONFIG);
    const { stdout } = await run(
      process.execPath,
      [
        cli.entry,
        "migrate",
        "diff",
        "--config",
        "prisma.config.mjs",
        "--from-empty",
        "--to-schema",
        "schema.prisma",
        "--script",
      ],
      {
        cwd: directory,
        // Only what the CLI needs: none of the server's secrets or database URLs.
        env: {
          NODE_ENV: "production",
          PATH: process.env.PATH ?? "",
          HOME: directory,
          TMPDIR: directory,
          CHECKPOINT_DISABLE: "1",
          PRISMA_HIDE_UPDATE_MESSAGE: "1",
          NO_COLOR: "1",
        },
        timeout: PRISMA_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return { ddl: stdout, prismaVersion: cli.version };
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    const failure = error as { killed?: boolean; stderr?: string };
    if (failure.killed === true) {
      throw new UserFacingError(
        `Prisma did not finish within ${PRISMA_TIMEOUT_MS / 1000} seconds.`,
      );
    }
    const detail = prismaMessage(failure.stderr ?? "", directory);
    throw new UserFacingError(
      `Prisma could not read the schema.${detail === "" ? "" : `\n\n${detail}`}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Turns a `schema.prisma` into a snapshot through Prisma's CLI and the shadow database.
 * Connection URLs are removed before anything else happens, so the stored schema file
 * (an artifact, for provenance and download) never contains them.
 */
export async function prismaSnapshot(text: string) {
  if (text.trim() === "") {
    throw new UserFacingError("Upload or paste a schema.prisma file.");
  }
  if (Buffer.byteLength(text) > MAX_PRISMA_SCHEMA_BYTES) {
    throw new UserFacingError(
      `The schema is larger than ${MAX_PRISMA_SCHEMA_BYTES / 1024} KB.`,
    );
  }
  const prepared = preparePrismaSchema(text);
  const { ddl, prismaVersion } = await prismaDdl(prepared.schema);
  const { snapshot, unsupported } = await snapshotFromDdl(ddl);
  const schemaFile = await artifacts().put(
    new TextEncoder().encode(prepared.schema),
  );
  return {
    snapshot,
    unsupported,
    removed: prepared.removed,
    source: {
      kind: "prisma-schema",
      prismaVersion,
      schemaChecksum: schemaFile.checksum,
    },
  };
}

/**
 * Records a `schema.prisma` as the first version on main (the baseline). Later changes go
 * through a branch: see uploadPrismaToBranch in lib/branches.ts.
 */
export async function importPrismaSchema(
  actor: Actor,
  project: Project,
  text: string,
): Promise<ImportResult & { removed: string[] }> {
  assertCan(actor, "author-migrations");
  requireSchemaSource(project, "code");
  if ((await listVersions(actor, project)).length > 0) {
    throw new UserFacingError(
      "Main already has a version. Start a branch and upload the changed schema there, so the change is reviewed.",
    );
  }
  const imported = await prismaSnapshot(text);
  const result = await recordVersion(actor, project, {
    snapshot: imported.snapshot,
    unsupported: imported.unsupported,
    source: imported.source,
    basedOn: { versionId: null },
  });
  return { ...result, removed: imported.removed };
}
