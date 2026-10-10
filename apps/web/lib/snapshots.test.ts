import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { serializeSnapshot } from "@skematron/core";
import { column, namespace, snapshot, table } from "@skematron/core/testing";
import { createSnapshotStore, SnapshotStoreError } from "./snapshots.ts";

const sample = (columnName: string) =>
  snapshot(
    namespace("demo", {
      tables: [table("users", { columns: [column(columnName, "integer")] })],
    }),
  );

describe("snapshot store", () => {
  let directory = "";
  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "skematron-snapshots-"));
  });
  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("saves the canonical bytes and loads them back verified", async () => {
    const store = createSnapshotStore(directory);
    const record = await store.save(sample("id"), {
      namespace: "demo",
      source: "PostgreSQL 14.20",
      now: new Date("2026-10-10T13:15:00.123Z"),
    });
    assert.match(record.id, /^20261010T131500Z-[0-9a-f]{12}$/);
    assert.equal(
      await readFile(join(directory, `${record.id}.json`), "utf8"),
      serializeSnapshot(sample("id")),
    );
    const loaded = await store.load(record.id);
    assert.deepEqual(loaded.record, record);
    assert.equal(
      serializeSnapshot(loaded.snapshot),
      serializeSnapshot(sample("id")),
    );
  });

  it("lists snapshots newest first", async () => {
    const store = createSnapshotStore(directory);
    const later = await store.save(sample("email"), {
      namespace: "demo",
      source: "PostgreSQL 14.20",
      now: new Date("2026-10-11T08:00:00Z"),
    });
    const listed = await store.list();
    assert.equal(listed[0]!.id, later.id);
    assert.equal(listed.length, 2);
  });

  it("never overwrites a saved snapshot", async () => {
    const store = createSnapshotStore(directory);
    const details = {
      namespace: "demo",
      source: "x",
      now: new Date("2026-10-12T00:00:00Z"),
    };
    await store.save(sample("a"), details);
    await assert.rejects(store.save(sample("a"), details), { code: "EEXIST" });
  });

  it("detects a changed file", async () => {
    const store = createSnapshotStore(directory);
    const record = await store.save(sample("b"), {
      namespace: "demo",
      source: "x",
      now: new Date("2026-10-13T00:00:00Z"),
    });
    await writeFile(
      join(directory, `${record.id}.json`),
      serializeSnapshot(sample("tampered")),
    );
    await assert.rejects(store.load(record.id), SnapshotStoreError);
  });

  it("rejects ids that are not snapshot ids, including path traversal", async () => {
    const store = createSnapshotStore(directory);
    for (const id of [
      "../../etc/passwd",
      "20261010T131500Z-zzzzzzzzzzzz",
      "",
    ]) {
      await assert.rejects(store.load(id), SnapshotStoreError);
    }
  });

  it("reports a missing snapshot clearly", async () => {
    await assert.rejects(
      createSnapshotStore(directory).load("20990101T000000Z-000000000000"),
      /does not exist/,
    );
  });

  it("lists nothing when the directory does not exist yet", async () => {
    assert.deepEqual(
      await createSnapshotStore(join(directory, "missing")).list(),
      [],
    );
  });
});
