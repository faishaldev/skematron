import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";

// Storage is a small I/O layer: Node built-ins and its own modules only.
it("storage source imports only node: built-ins and relative modules", async () => {
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
        imported.startsWith("./") || imported.startsWith("node:"),
        `${file} imports ${JSON.stringify(imported)}`,
      );
    }
  }
});
