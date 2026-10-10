// Schema versions: immutable snapshots of a project's schema, stored as content-addressed
// artifacts (checksum = artifact key) with their metadata in the metadata database.
import {
  serializeSnapshot,
  snapshotChecksum,
  type SchemaSnapshot,
} from "@skematron/core";
import type { UnsupportedObject } from "@skematron/adapters";
import { createArtifactStore } from "@skematron/storage";
import type { Actor } from "./actor.ts";
import { recordAudit } from "./audit.ts";
import { db } from "./db.ts";
import { artifactDirectory } from "./env.ts";
import { NotFoundError } from "./errors.ts";
import { assertCan, type Environment, type Project } from "./projects.ts";
import { readLive } from "./targets.ts";

export const artifacts = () => createArtifactStore(artifactDirectory());

export type ImportResult =
  | { status: "created"; number: number }
  | { status: "unchanged"; number: number };

/** Introspects the environment (read-only) and records the result as the next version. */
export async function importVersion(
  actor: Actor,
  project: Project,
  environment: Environment,
): Promise<ImportResult> {
  assertCan(actor, "use-databases");
  const { snapshot, unsupported, serverVersion } = await readLive(environment);
  return recordVersion(actor, project, {
    snapshot,
    unsupported,
    source: {
      kind: "introspection",
      adapter: "postgresql",
      environmentId: environment.id,
      environmentName: environment.name,
      serverVersion,
    },
  });
}

/**
 * Stores a snapshot as the project's next version, unless it is identical to the latest one.
 * A per-project advisory lock keeps numbering sequential and the identity check race-free.
 */
export async function recordVersion(
  actor: Actor,
  project: Project,
  input: {
    snapshot: SchemaSnapshot;
    unsupported: UnsupportedObject[];
    source: Record<string, string>;
  },
): Promise<ImportResult> {
  const text = serializeSnapshot(input.snapshot);
  const checksum = await snapshotChecksum(input.snapshot);
  // Stored first: artifacts are content-addressed, so an unused one is harmless.
  const stored = await artifacts().put(new TextEncoder().encode(text));
  if (stored.checksum !== checksum) {
    throw new Error("Artifact checksum does not match the snapshot checksum.");
  }
  const result = await db().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`version:${project.id}`}, 0))`;
    const latest = await tx.schemaVersion.findFirst({
      where: { projectId: project.id },
      orderBy: { number: "desc" },
    });
    if (latest?.checksum === checksum) {
      return { status: "unchanged", number: latest.number } as const;
    }
    const version = await tx.schemaVersion.create({
      data: {
        projectId: project.id,
        number: (latest?.number ?? 0) + 1,
        checksum,
        dialect: input.snapshot.dialect,
        formatVersion: input.snapshot.formatVersion,
        sizeBytes: stored.sizeBytes,
        source: input.source,
        unsupported: input.unsupported.map((object) => ({ ...object })),
        createdById: actor.userId,
      },
    });
    return {
      status: "created",
      number: version.number,
      id: version.id,
    } as const;
  });
  if (result.status === "created") {
    await recordAudit({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: "version.import",
      targetType: "schema_version",
      targetId: result.id,
      details: {
        project: project.slug,
        number: result.number,
        checksum,
        environment: input.source.environmentName ?? null,
      },
    });
    return { status: "created", number: result.number };
  }
  return result;
}

export async function listVersions(actor: Actor, project: Project) {
  assertCan(actor, "read");
  return db().schemaVersion.findMany({
    where: { projectId: project.id },
    orderBy: { number: "desc" },
  });
}

export async function getVersion(
  actor: Actor,
  project: Project,
  number: number,
) {
  assertCan(actor, "read");
  const version = Number.isSafeInteger(number)
    ? await db().schemaVersion.findUnique({
        where: { projectId_number: { projectId: project.id, number } },
      })
    : null;
  if (version === null) throw new NotFoundError(`Version ${number} not found.`);
  return version;
}

export type SchemaVersion = Awaited<ReturnType<typeof getVersion>>;

/** Loads a version's snapshot from the artifact store, verified against its checksum. */
export async function loadSnapshot(
  version: SchemaVersion,
): Promise<SchemaSnapshot> {
  const text = new TextDecoder().decode(
    await artifacts().get(version.checksum),
  );
  const snapshot = JSON.parse(text) as SchemaSnapshot;
  if (serializeSnapshot(snapshot) !== text) {
    throw new Error(`Version ${version.number} is not a canonical snapshot.`);
  }
  return snapshot;
}

export function unsupportedOf(version: SchemaVersion): UnsupportedObject[] {
  return Array.isArray(version.unsupported)
    ? (version.unsupported as unknown as UnsupportedObject[])
    : [];
}
