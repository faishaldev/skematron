import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  ConnectionUrlError,
  redactConnectionUrl,
  validateConnectionUrl,
} from "./connections.ts";
import {
  assignableRoles,
  can,
  canManageMember,
  parseRole,
  ROLES,
  type Permission,
  type Role,
} from "./roles.ts";
import {
  decryptSecret,
  encryptSecret,
  parseSecretKey,
  SecretError,
} from "./secrets.ts";
import {
  columnNames,
  identifier,
  referentialAction,
  SchemaInputError,
  sqlDefault,
  sqlType,
} from "./schema-input.ts";
import { isSlug, slugify } from "./slugs.ts";

describe("roles", () => {
  it("grants each permission from its minimum role upward", () => {
    const expected: Record<Permission, Role[]> = {
      read: ["viewer", "member", "admin", "owner"],
      "use-databases": ["member", "admin", "owner"],
      "manage-projects": ["admin", "owner"],
      "manage-members": ["admin", "owner"],
      "view-audit": ["admin", "owner"],
      "author-migrations": ["member", "admin", "owner"],
      "review-migrations": ["admin", "owner"],
    };
    for (const [permission, roles] of Object.entries(expected)) {
      assert.deepEqual(
        ROLES.filter((role) => can(role, permission as Permission)),
        roles,
        permission,
      );
    }
  });

  it("parses Better Auth role fields, taking the highest role", () => {
    assert.equal(parseRole("admin"), "admin");
    assert.equal(parseRole("member, admin"), "admin");
    assert.equal(parseRole("sales"), null);
    assert.equal(parseRole(""), null);
  });

  it("lets admins and owners hand out roles up to their level, never owner", () => {
    assert.deepEqual(assignableRoles("owner"), ["viewer", "member", "admin"]);
    assert.deepEqual(assignableRoles("admin"), ["viewer", "member", "admin"]);
    assert.deepEqual(assignableRoles("member"), []);
    assert.deepEqual(assignableRoles("viewer"), []);
  });

  it("never lets anyone manage the owner, or members above themselves", () => {
    assert.equal(canManageMember("owner", "owner"), false);
    assert.equal(canManageMember("admin", "owner"), false);
    assert.equal(canManageMember("admin", "admin"), true);
    assert.equal(canManageMember("owner", "viewer"), true);
    assert.equal(canManageMember("member", "viewer"), false);
  });
});

describe("secrets", () => {
  const key = randomBytes(32);
  const url = "postgresql://app:s3cr%40t@db.internal:5432/app";

  it("round-trips and never contains the plaintext", () => {
    const token = encryptSecret(url, key);
    assert.match(token, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.ok(!token.includes("s3cr"));
    assert.equal(decryptSecret(token, key), url);
    assert.notEqual(encryptSecret(url, key), token, "a fresh IV each time");
  });

  it("rejects a wrong key, tampered data and unknown formats", () => {
    const token = encryptSecret(url, key);
    assert.throws(() => decryptSecret(token, randomBytes(32)), SecretError);
    const [version, iv, data, tag] = token.split(".") as [
      string,
      string,
      string,
      string,
    ];
    const flipped = `${data.startsWith("A") ? "B" : "A"}${data.slice(1)}`;
    assert.throws(
      () => decryptSecret([version, iv, flipped, tag].join("."), key),
      SecretError,
    );
    assert.throws(() => decryptSecret("v2.a.b.c", key), SecretError);
    assert.throws(() => decryptSecret(url, key), SecretError);
  });

  it("accepts only 32-byte base64 keys", () => {
    assert.equal(parseSecretKey(key.toString("base64")).length, 32);
    assert.throws(
      () => parseSecretKey(randomBytes(16).toString("base64")),
      SecretError,
    );
    assert.throws(() => parseSecretKey(""), SecretError);
  });
});

describe("connection URLs", () => {
  it("accepts PostgreSQL URLs and redacts the password", () => {
    const { url, hint } = validateConnectionUrl(
      " postgres://app:p%40ss:w0rd@db.internal:5432/app?sslmode=require ",
    );
    assert.equal(decodeURIComponent(new URL(url).password), "p@ss:w0rd");
    assert.equal(hint, "postgresql://app@db.internal:5432/app");
    assert.ok(!hint.includes("ss:w0rd"));
  });

  it("shows a socket directory instead of a host", () => {
    assert.equal(
      redactConnectionUrl(
        "postgresql:///skematron_test?host=/tmp/pg&port=54329",
      ),
      "postgresql:///skematron_test (socket /tmp/pg)",
    );
  });

  it("rejects other protocols, missing parts and dangerous parameters", () => {
    for (const input of [
      "mysql://u:p@h/db",
      "not a url",
      "postgresql://u:p@host",
      "postgresql://u:p@host/",
      "postgresql://u:p@host/a/b",
      "postgresql:///db",
      "postgresql://u:p@host/db?sslrootcert=/etc/passwd",
      "postgresql://u:p@host/db?options=-csearch_path%3Devil",
      "postgresql://u@host/db?password=secret",
    ]) {
      assert.throws(
        () => validateConnectionUrl(input),
        ConnectionUrlError,
        input,
      );
    }
  });

  it("never echoes the password in its error messages", () => {
    try {
      validateConnectionUrl("postgresql://u:hunter2@host/db?sslkey=/x");
      assert.fail("expected an error");
    } catch (error) {
      assert.ok(!(error as Error).message.includes("hunter2"));
    }
  });
});

describe("slugs", () => {
  it("makes URL-safe slugs", () => {
    assert.equal(slugify("  Billing API (v2) "), "billing-api-v2");
    assert.equal(slugify("Café Ünïcode"), "cafe-unicode");
    assert.equal(slugify("!!!"), "project");
    assert.ok(isSlug(slugify("x".repeat(80))));
    assert.equal(isSlug("../etc"), false);
    assert.equal(isSlug("ok-slug-1"), true);
  });
});

describe("schema editor input", () => {
  it("accepts the types people write and normalizes spacing", () => {
    for (const type of [
      "text",
      "int",
      "bigint",
      "numeric(10,2)",
      "numeric(10, 2)",
      "character varying(255)",
      "timestamp with time zone",
      "timestamp(3) without time zone",
      "double precision",
      "app.order_status",
      '"Role"',
      'public."Role"',
      "text[]",
      "integer[][]",
    ]) {
      assert.equal(sqlType(type), type);
    }
    assert.equal(
      sqlType("  timestamp   with time zone "),
      "timestamp with time zone",
    );
  });

  it("rejects types that could carry other SQL", () => {
    for (const type of [
      "",
      "text; DROP TABLE users",
      "text, other integer",
      "text DEFAULT 1",
      "text -- comment",
      "int /* x */",
      "text'",
      "numeric(10,2,3)",
      "x".repeat(101),
    ]) {
      assert.throws(() => sqlType(type), SchemaInputError, type);
    }
  });

  it("accepts one default expression without separators or comments", () => {
    assert.equal(sqlDefault("  "), null);
    assert.equal(sqlDefault("'draft'"), "'draft'");
    assert.equal(sqlDefault("now()"), "now()");
    for (const value of [
      "1; DROP TABLE t",
      "0 -- x",
      "0 /* x */",
      "a\u0000b",
    ]) {
      assert.throws(() => sqlDefault(value), SchemaInputError, value);
    }
  });

  it("checks names, column lists and referential actions", () => {
    assert.equal(identifier("  users ", "Name"), "users");
    assert.throws(() => identifier("", "Name"), SchemaInputError);
    assert.throws(() => identifier("x".repeat(64), "Name"), /1 to 63 bytes/);
    assert.deepEqual(columnNames("a, b ,c", "columns"), ["a", "b", "c"]);
    assert.deepEqual(columnNames(" ", "columns", true), []);
    assert.throws(() => columnNames(" ", "columns"), /List the columns/);
    assert.equal(referentialAction("cascade"), "cascade");
    assert.throws(() => referentialAction("explode"), SchemaInputError);
  });
});
