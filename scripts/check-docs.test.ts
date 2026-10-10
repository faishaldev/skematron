import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  missingChangelog,
  parsePorcelain,
  requiresChangelog,
} from "./check-docs.ts";

describe("requiresChangelog", () => {
  it("requires an entry for source, scripts and configuration", () => {
    for (const path of [
      "packages/core/src/plan.ts",
      "packages/adapters/src/postgres/introspect.ts",
      "apps/cli/src/main.ts",
      "scripts/sync-ai.ts",
      "scripts/test-postgres.sh",
      "package.json",
      "packages/core/package.json",
      "tsconfig.json",
    ]) {
      assert.equal(requiresChangelog(path), true, path);
    }
  });

  it("does not require an entry for tests, fixtures, docs or lockfiles", () => {
    for (const path of [
      "packages/core/src/plan.test.ts",
      "packages/adapters/src/postgres/fixtures/v1.sql",
      "ai/knowledges/gotchas.md",
      "README.md",
      "pnpm-lock.yaml",
    ]) {
      assert.equal(requiresChangelog(path), false, path);
    }
  });
});

describe("missingChangelog", () => {
  it("lists source changes when CHANGELOG.md is unchanged", () => {
    assert.deepEqual(
      missingChangelog(["packages/core/src/plan.ts", "README.md"]),
      ["packages/core/src/plan.ts"],
    );
  });

  it("passes when CHANGELOG.md changed too", () => {
    assert.deepEqual(
      missingChangelog(["packages/core/src/plan.ts", "CHANGELOG.md"]),
      [],
    );
  });
});

describe("parsePorcelain", () => {
  it("reads modified, untracked and renamed paths", () => {
    const output = [
      " M packages/core/src/plan.ts",
      "?? scripts/new.ts",
      "R  scripts/after.ts",
      "scripts/before.ts",
      "",
    ].join("\0");
    assert.deepEqual(parsePorcelain(output), [
      "packages/core/src/plan.ts",
      "scripts/new.ts",
      "scripts/after.ts",
    ]);
  });

  it("returns nothing for a clean tree", () => {
    assert.deepEqual(parsePorcelain(""), []);
  });
});
