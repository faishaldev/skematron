import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  ArtifactStoreError,
  createArtifactStore,
  sha256,
} from "./artifact-store.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("artifact store", () => {
  let directory = "";
  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "skematron-artifacts-"));
  });
  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("stores bytes under their SHA-256 and reads them back verified", async () => {
    const store = createArtifactStore(directory);
    const stored = await store.put(bytes("hello"));
    assert.equal(stored.checksum, sha256(bytes("hello")));
    assert.equal(stored.sizeBytes, 5);
    assert.equal(
      new TextDecoder().decode(await store.get(stored.checksum)),
      "hello",
    );
    assert.equal(await store.has(stored.checksum), true);
  });

  it("treats storing identical bytes again as a no-op and leaves no temporary files", async () => {
    const store = createArtifactStore(directory);
    const first = await store.put(bytes("same"));
    const second = await store.put(bytes("same"));
    assert.deepEqual(first, second);
    const files = await readdir(directory, { recursive: true });
    assert.ok(!files.some((file) => file.endsWith(".tmp")));
  });

  it("survives concurrent writes of the same artifact", async () => {
    const store = createArtifactStore(directory);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.put(bytes("concurrent"))),
    );
    assert.equal(new Set(results.map((result) => result.checksum)).size, 1);
    assert.equal(
      new TextDecoder().decode(await store.get(results[0]!.checksum)),
      "concurrent",
    );
  });

  it("detects a changed file", async () => {
    const store = createArtifactStore(directory);
    const { checksum } = await store.put(bytes("original"));
    const hex = checksum.slice("sha256:".length);
    await writeFile(
      join(directory, "sha256", hex.slice(0, 2), hex),
      "tampered",
    );
    await assert.rejects(store.get(checksum), ArtifactStoreError);
    await assert.rejects(store.put(bytes("original")), ArtifactStoreError);
  });

  it("reports a missing artifact clearly", async () => {
    await assert.rejects(
      createArtifactStore(directory).get(sha256(bytes("never stored"))),
      /missing/,
    );
  });

  it("rejects keys that are not SHA-256 checksums, including path traversal", async () => {
    const store = createArtifactStore(directory);
    for (const key of [
      "../../etc/passwd",
      "sha256:../../x",
      "sha256:ABC",
      "md5:00",
      "",
    ]) {
      await assert.rejects(store.get(key), ArtifactStoreError, key);
    }
  });
});
