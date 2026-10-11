import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { preparePrismaSchema, PrismaSchemaError } from "./schema-file.ts";

const SCHEMA = `// Prisma 6 style, with connection URLs in the datasource.
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["views"] // kept: the schema depends on it
}

datasource db {
  provider          = "postgresql"
  url               = env("DATABASE_URL")
  directUrl         = "postgresql://user:secret@db.example.com/app"
  shadowDatabaseUrl = env("SHADOW_URL") // removed too
  schemas           = ["public"]
}

/// A bookmark; "{" in strings and comments does not open a block.
model Link {
  id  Int    @id @default(autoincrement())
  url String @default("https://example.com/{path}")
}
`;

describe("preparePrismaSchema", () => {
  it("removes connection URLs from the datasource and keeps everything else", () => {
    const prepared = preparePrismaSchema(SCHEMA);
    assert.equal(prepared.provider, "postgresql");
    assert.deepEqual(prepared.removed, [
      "url",
      "directUrl",
      "shadowDatabaseUrl",
    ]);
    assert.ok(!prepared.schema.includes("secret"));
    assert.ok(!prepared.schema.includes("DATABASE_URL"));
    assert.ok(!prepared.schema.includes("SHADOW_URL"));
    // Line numbers stay the same, so Prisma's errors point at the uploaded file.
    assert.equal(prepared.schema.split("\n").length, SCHEMA.split("\n").length);
    // Generators, other datasource properties and model fields named "url" stay.
    assert.match(prepared.schema, /previewFeatures = \["views"\]/);
    assert.match(prepared.schema, /schemas {11}= \["public"\]/);
    assert.match(prepared.schema, /url String @default/);
  });

  it("accepts a schema without URLs and the postgres alias, with CRLF line endings", () => {
    const schema =
      'datasource db {\r\n  provider = "postgres"\r\n  url = env("X")\r\n}\r\n';
    const prepared = preparePrismaSchema(schema);
    assert.equal(
      prepared.schema,
      'datasource db {\r\n  provider = "postgres"\r\n\r\n}\r\n',
    );
    assert.deepEqual(
      preparePrismaSchema('datasource db {\n  provider = "postgresql"\n}\n')
        .removed,
      [],
    );
  });

  it("rejects other providers", () => {
    for (const provider of ["mysql", "sqlite", "cockroachdb", "mongodb"]) {
      assert.throws(
        () =>
          preparePrismaSchema(
            `datasource db {\n  provider = "${provider}"\n}\n`,
          ),
        new RegExp(`uses "${provider}"`),
      );
    }
  });

  it("rejects schemas without exactly one usable datasource", () => {
    const cases = [
      "model A {\n  id Int @id\n}\n",
      'datasource a {\n  provider = "postgresql"\n}\ndatasource b {\n  provider = "postgresql"\n}\n',
      'datasource db {\n  relationMode = "prisma"\n}\n',
      'datasource db { provider = "postgresql" }\n',
    ];
    for (const schema of cases)
      assert.throws(
        () => preparePrismaSchema(schema),
        PrismaSchemaError,
        schema,
      );
  });

  it("rejects text that is not a Prisma schema", () => {
    const cases = [
      'datasource db {\n  provider = "postgresql"\n',
      "}\n",
      "SELECT 1;\n",
      "model A {\n  id Int @id\n}\0\n",
    ];
    for (const schema of cases)
      assert.throws(
        () => preparePrismaSchema(schema),
        PrismaSchemaError,
        schema,
      );
  });
});
