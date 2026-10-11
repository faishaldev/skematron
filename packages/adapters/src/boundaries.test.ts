import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";

// Adapters depend only on core. Drivers such as `pg` are test-only: callers pass in a session.
it("adapter source imports only relative modules and @skematron/core", async () => {
  const sourceDir = import.meta.dirname;
  const files = (await readdir(sourceDir, { recursive: true })).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );
  assert.ok(files.length > 0);
  const specifier = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
  for (const file of files) {
    const source = await readFile(join(sourceDir, file), "utf8");
    for (const match of source.matchAll(specifier)) {
      const imported = match[1]!;
      assert.ok(
        imported.startsWith("./") ||
          imported.startsWith("../") ||
          imported === "@skematron/core",
        `${file} imports ${JSON.stringify(imported)}; adapters may only import their own modules and @skematron/core`,
      );
    }
  }
});

// Schema-tool adapters (Prisma Schema) and database adapters (PostgreSQL) stay separate.
it("the Prisma schema adapter does not import the PostgreSQL adapter", async () => {
  const directory = join(import.meta.dirname, "prisma");
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith(".ts"),
  );
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(join(directory, file), "utf8");
    assert.ok(
      !source.includes("../postgres"),
      `prisma/${file} imports the PostgreSQL adapter`,
    );
  }
});
