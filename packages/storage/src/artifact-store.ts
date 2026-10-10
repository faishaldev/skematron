// Content-addressed artifact storage on the local filesystem.
// An artifact's key is the SHA-256 of its bytes ("sha256:<hex>"); for a schema snapshot
// that is the same value as the snapshot checksum. Artifacts are immutable: written once
// (atomically), never overwritten, and verified against their key on every read.
import { createHash, randomBytes } from "node:crypto";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class ArtifactStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactStoreError";
  }
}

export interface StoredArtifact {
  checksum: string;
  sizeBytes: number;
}

const CHECKSUM_PATTERN = /^sha256:([0-9a-f]{64})$/;

export function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function hexOf(checksum: string): string {
  const match = CHECKSUM_PATTERN.exec(checksum);
  if (match === null) {
    // Keys may come from URLs or the database; the pattern also rules out path traversal.
    throw new ArtifactStoreError(
      `Invalid artifact checksum ${JSON.stringify(checksum)}.`,
    );
  }
  return match[1]!;
}

export function createArtifactStore(directory: string) {
  const pathOf = (checksum: string): string => {
    const hex = hexOf(checksum);
    return join(directory, "sha256", hex.slice(0, 2), hex);
  };

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  /** Reads an artifact and verifies it against its key. */
  async function get(checksum: string): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(pathOf(checksum));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ArtifactStoreError(
          `Artifact ${checksum} is missing from the store.`,
        );
      }
      throw error;
    }
    if (sha256(bytes) !== checksum) {
      throw new ArtifactStoreError(
        `Artifact ${checksum} does not match its checksum; the file was changed or corrupted.`,
      );
    }
    return bytes;
  }

  /** Stores the bytes and returns their key. Storing the same bytes again is a no-op. */
  async function put(bytes: Uint8Array): Promise<StoredArtifact> {
    const checksum = sha256(bytes);
    const path = pathOf(checksum);
    if (await exists(path)) {
      await get(checksum); // Verifies the existing copy.
      return { checksum, sizeBytes: bytes.byteLength };
    }
    await mkdir(dirname(path), { recursive: true });
    // Write to a temporary file, then hard-link it into place: readers never see a partial
    // file, and link() fails instead of overwriting if another writer won the race.
    const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, bytes, { flag: "wx" });
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await rm(temporary, { force: true });
    }
    return { checksum, sizeBytes: bytes.byteLength };
  }

  return {
    put,
    get,
    has: (checksum: string): Promise<boolean> => exists(pathOf(checksum)),
  };
}

export type ArtifactStore = ReturnType<typeof createArtifactStore>;
