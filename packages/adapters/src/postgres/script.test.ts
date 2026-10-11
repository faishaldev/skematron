import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  preparePostgresScript,
  splitPostgresScript,
  SqlScriptError,
} from "./script.ts";

const fixture = (name: string) =>
  readFile(join(import.meta.dirname, "fixtures/scripts", name), "utf8");

const sqlOf = (text: string) =>
  splitPostgresScript(text).map((piece) => piece.sql);

describe("splitPostgresScript", () => {
  it("splits on semicolons and records the line each statement starts on", () => {
    assert.deepEqual(
      splitPostgresScript(
        "CREATE TABLE a (id int);\n\n  CREATE TABLE b (id int)\n;",
      ),
      [
        { sql: "CREATE TABLE a (id int)", line: 1, meta: false },
        { sql: "CREATE TABLE b (id int)", line: 3, meta: false },
      ],
    );
  });

  it("keeps semicolons inside strings, identifiers, comments and dollar quotes", () => {
    const statements = sqlOf(
      [
        "COMMENT ON TABLE a IS 'one; it''s two';",
        'CREATE TABLE "semi;colon" (id int);',
        "-- a comment; with a semicolon\nCREATE TABLE c (id int /* ; /* nested; */ still */);",
        "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $body$ BEGIN RAISE NOTICE $x$;$x$; RETURN 1; END; $body$;",
        "SELECT E'escaped \\' quote; still a string';",
        "SELECT $$;$$, U&'d\\0061t;a';",
      ].join("\n"),
    );
    assert.equal(statements.length, 6);
    assert.equal(statements[1], 'CREATE TABLE "semi;colon" (id int)');
    // A statement starts at its first token, after any comments.
    assert.equal(
      statements[2],
      "CREATE TABLE c (id int /* ; /* nested; */ still */)",
    );
    assert.match(statements[3]!, /END; \$body\$$/);
  });

  it("does not take positional parameters or identifiers with $ for dollar quotes", () => {
    assert.deepEqual(sqlOf("SELECT a$b$ FROM t; PREPARE p AS SELECT $1;"), [
      "SELECT a$b$ FROM t",
      "PREPARE p AS SELECT $1",
    ]);
  });

  it("keeps BEGIN ATOMIC function bodies together, like psql", () => {
    const statements = sqlOf(
      [
        "CREATE OR REPLACE FUNCTION f(a int) RETURNS int LANGUAGE sql",
        "BEGIN ATOMIC",
        "  SELECT CASE WHEN a > 0 THEN 1 ELSE 0 END;",
        "  SELECT a;",
        "END;",
        "CREATE TABLE after_it (id int);",
      ].join("\n"),
    );
    assert.equal(statements.length, 2);
    assert.match(statements[0]!, /^CREATE OR REPLACE FUNCTION[\s\S]*\nEND$/);
    // Outside CREATE FUNCTION, BEGIN is a statement of its own.
    assert.deepEqual(sqlOf("BEGIN; CREATE TABLE t (id int); COMMIT;"), [
      "BEGIN",
      "CREATE TABLE t (id int)",
      "COMMIT",
    ]);
  });

  it("keeps semicolons inside parentheses (rule actions)", () => {
    assert.equal(
      sqlOf(
        "CREATE RULE r AS ON INSERT TO t DO INSTEAD (INSERT INTO u VALUES (1); INSERT INTO u VALUES (2));",
      ).length,
      1,
    );
  });

  it("reads psql meta-commands at the start of a line as their own pieces", () => {
    assert.deepEqual(
      splitPostgresScript(
        "\\restrict abc\nCREATE TABLE t (id int);\n\\unrestrict abc\n",
      ),
      [
        { sql: "\\restrict abc", line: 1, meta: true },
        { sql: "CREATE TABLE t (id int)", line: 2, meta: false },
        { sql: "\\unrestrict abc", line: 3, meta: true },
      ],
    );
  });

  it("names the line of a string, comment or dollar quote that is never closed", () => {
    for (const [text, line] of [
      ["SELECT 1;\nSELECT 'open", 2],
      ['SELECT 1;\n\nSELECT "open', 3],
      ["/* open\n\n", 1],
      ["SELECT 1;\nCREATE FUNCTION f() AS $x$ BEGIN", 2],
    ] as const) {
      assert.throws(
        () => splitPostgresScript(text),
        (error: unknown) =>
          error instanceof SqlScriptError && error.line === line,
        text,
      );
    }
  });
});

describe("preparePostgresScript", () => {
  it("skips ownership, privileges, time limits, untracked comments and psql setup", () => {
    const prepared = preparePostgresScript(
      [
        "\\restrict key",
        "SET statement_timeout = 0;",
        "SET lock_timeout = 0;",
        "SELECT pg_catalog.set_config('search_path', '', false);",
        "CREATE TABLE public.t (owner text);",
        "ALTER TABLE public.t OWNER TO someone;",
        'ALTER FUNCTION public.f(a integer, b text) OWNER TO "Some One";',
        "GRANT SELECT ON TABLE public.t TO reader;",
        "REVOKE ALL ON SCHEMA public FROM PUBLIC;",
        "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO reader;",
        "SET SESSION AUTHORIZATION 'someone';",
        "COMMENT ON EXTENSION citext IS 'case-insensitive';",
        "COMMENT ON SCHEMA public IS 'standard public schema';",
        "\\unrestrict key",
      ].join("\n"),
    );
    assert.deepEqual(
      prepared.statements.map((statement) => statement.line),
      [4, 5],
    );
    assert.deepEqual(
      prepared.skipped.map((statement) => [statement.line, statement.reason]),
      [
        [1, "psql command"],
        [2, "time limit (Skematron's own limits apply)"],
        [3, "time limit (Skematron's own limits apply)"],
        [6, "ownership"],
        [7, "ownership"],
        [8, "privileges"],
        [9, "privileges"],
        [10, "privileges"],
        [11, "ownership"],
        [12, "comment Skematron does not track"],
        [13, "comment Skematron does not track"],
        [14, "psql command"],
      ],
    );
  });

  it("runs renames to a column called owner and ALTER TABLE with more actions", () => {
    const prepared = preparePostgresScript(
      [
        "ALTER TABLE t RENAME COLUMN owner TO proprietor;",
        "ALTER TABLE t RENAME owner TO proprietor;",
        "ALTER TABLE t ADD COLUMN a int, OWNER TO someone;",
      ].join("\n"),
    );
    assert.equal(prepared.statements.length, 3);
    assert.equal(prepared.skipped.length, 0);
  });

  it("skips rows written to a migration tool's history table, and only those", () => {
    const prepared = preparePostgresScript(
      [
        "UPDATE alembic_version SET version_num='0002' WHERE alembic_version.version_num = '0001';",
        'INSERT INTO "public"."_prisma_migrations" (id) VALUES (\'x\');',
        "INSERT INTO \"SequelizeMeta\" (name) VALUES ('a.js');",
        "INSERT INTO SequelizeMeta (name) VALUES ('folded to lower case');",
        "DELETE FROM ONLY public.schema_migrations;",
        "INSERT INTO users (email) VALUES ('kept@example.com');",
      ].join("\n"),
    );
    assert.deepEqual(
      prepared.skipped.map((statement) => [statement.line, statement.reason]),
      [
        [1, "Alembic migration history"],
        [2, "Prisma migration history"],
        [3, "Sequelize migration history"],
        [5, "Rails, golang-migrate or dbmate migration history"],
      ],
    );
    assert.deepEqual(
      prepared.statements.map((statement) => statement.line),
      [4, 6],
    );
  });

  it("refuses scripts with rows, other databases, server changes or psql commands", () => {
    for (const [text, message] of [
      ["CREATE TABLE t (id int);\nCOPY public.t (id) FROM stdin;", /COPY/],
      ["CREATE DATABASE app;", /whole database/],
      ["DROP DATABASE skematron_shadow_0123456789abcdef;", /whole database/],
      ["ALTER DATABASE app SET search_path = app;", /whole database/],
      ["CREATE ROLE app LOGIN;", /roles/],
      ["ALTER ROLE CURRENT_USER PASSWORD 'x';", /roles/],
      ["ALTER USER someone SET search_path = x;", /roles/],
      ["ALTER SYSTEM SET work_mem = '1GB';", /settings/],
      ["CREATE TABLESPACE fast LOCATION '/tmp';", /tablespaces/],
      ["LOAD 'auto_explain';", /server/],
      ["\\connect other", /\\connect/],
      ["\\i other.sql", /\\i/],
      ["\\copy t from 'rows.csv'", /\\copy/],
    ] as const) {
      assert.throws(
        () => preparePostgresScript(text),
        (error: unknown) =>
          error instanceof SqlScriptError && message.test(error.message),
        text,
      );
    }
  });

  it("reports the line of a refused statement", () => {
    assert.throws(
      () =>
        preparePostgresScript("CREATE TABLE t (id int);\n\nCOPY t FROM stdin;"),
      { name: "SqlScriptError", message: /^Line 3: COPY/ },
    );
  });
});

describe("real tool output", () => {
  // [fixture, statements to run, skipped]
  const CASES: [string, number, number][] = [
    ["pg-dump.sql", 31, 17],
    ["drizzle-export.sql", 5, 0],
    ["knex.sql", 6, 0],
    ["django-0001.sql", 7, 0],
    ["django-0002.sql", 3, 0],
    ["alembic-head.sql", 7, 1],
    ["alembic-0001-0002.sql", 3, 1],
    ["prisma-v1.sql", 7, 0],
    ["prisma-v1-to-v2.sql", 5, 0],
  ];
  for (const [name, run, skipped] of CASES) {
    it(`prepares ${name}`, async () => {
      const prepared = preparePostgresScript(await fixture(name));
      assert.equal(prepared.statements.length, run);
      assert.equal(prepared.skipped.length, skipped);
    });
  }

  it("keeps pg_dump's function bodies whole", async () => {
    const { statements } = preparePostgresScript(await fixture("pg-dump.sql"));
    const routines = statements.filter((statement) =>
      statement.sql.startsWith("CREATE FUNCTION"),
    );
    assert.equal(routines.length, 2);
    assert.match(routines[0]!.sql, /BEGIN ATOMIC[\s\S]*END$/);
    assert.match(routines[1]!.sql, /AS \$_\$[\s\S]*\$_\$$/);
  });
});
