// Saved snapshots on the local filesystem: Skematron's own artifacts, never user data.
// Each snapshot is two files: `<id>.json` holds the exact canonical serialization (so its
// SHA-256 is the snapshot checksum) and `<id>.meta.json` holds the record below.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  serializeSnapshot,
  snapshotChecksum,
  type SchemaSnapshot,
} from "@skematron/core";

export interface SnapshotRecord {
  id: string;
  namespace: string;
  /** ISO 8601 timestamp. */
  savedAt: string;
  checksum: string;
  /** Where the snapshot was read from, e.g. "PostgreSQL 14.20". */
  source: string;
}

export class SnapshotStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotStoreError";
  }
}

const ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{12}$/;

function assertId(id: string): void {
  // Ids come from URLs; the pattern also rules out path traversal.
  if (!ID_PATTERN.test(id)) {
    throw new SnapshotStoreError(`Invalid snapshot id ${JSON.stringify(id)}.`);
  }
}

function isRecord(value: unknown): value is SnapshotRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["id", "namespace", "savedAt", "checksum", "source"].every(
    (key) => typeof record[key] === "string",
  );
}

export function createSnapshotStore(directory: string) {
  return {
    async save(
      snapshot: SchemaSnapshot,
      details: { namespace: string; source: string; now?: Date },
    ): Promise<SnapshotRecord> {
      const text = serializeSnapshot(snapshot);
      const checksum = await snapshotChecksum(snapshot);
      const savedAt = (details.now ?? new Date()).toISOString();
      const stamp = savedAt.replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
      const id = `${stamp}-${checksum.slice("sha256:".length, "sha256:".length + 12)}`;
      const record: SnapshotRecord = {
        id,
        namespace: details.namespace,
        savedAt,
        checksum,
        source: details.source,
      };
      await mkdir(directory, { recursive: true });
      // flag "wx": saved snapshots are immutable and never overwritten.
      await writeFile(join(directory, `${id}.json`), text, { flag: "wx" });
      await writeFile(
        join(directory, `${id}.meta.json`),
        `${JSON.stringify(record, null, 2)}\n`,
        { flag: "wx" },
      );
      return record;
    },

    /** Newest first. */
    async list(): Promise<SnapshotRecord[]> {
      let files: string[];
      try {
        files = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const records: SnapshotRecord[] = [];
      for (const file of files.filter((name) => name.endsWith(".meta.json"))) {
        const parsed: unknown = JSON.parse(
          await readFile(join(directory, file), "utf8"),
        );
        if (!isRecord(parsed)) {
          throw new SnapshotStoreError(`Malformed snapshot record ${file}.`);
        }
        records.push(parsed);
      }
      return records.sort((a, b) =>
        a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0,
      );
    },

    /** Loads a snapshot and verifies its bytes against the recorded checksum. */
    async load(
      id: string,
    ): Promise<{ record: SnapshotRecord; snapshot: SchemaSnapshot }> {
      assertId(id);
      let metaText: string;
      let text: string;
      try {
        metaText = await readFile(join(directory, `${id}.meta.json`), "utf8");
        text = await readFile(join(directory, `${id}.json`), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new SnapshotStoreError(`Snapshot ${id} does not exist.`);
        }
        throw error;
      }
      const record: unknown = JSON.parse(metaText);
      if (!isRecord(record)) {
        throw new SnapshotStoreError(`Malformed snapshot record ${id}.`);
      }
      const snapshot = JSON.parse(text) as SchemaSnapshot;
      const canonical = serializeSnapshot(snapshot);
      if (
        canonical !== text ||
        (await snapshotChecksum(snapshot)) !== record.checksum
      ) {
        throw new SnapshotStoreError(
          `Snapshot ${id} does not match its checksum; the file was changed or corrupted.`,
        );
      }
      return { record, snapshot };
    },
  };
}

export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
