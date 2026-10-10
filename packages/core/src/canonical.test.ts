import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  canonicalizeSnapshot,
  compareNames,
  serializeSnapshot,
  snapshotChecksum,
  SnapshotValidationError,
} from "./canonical.ts";
import type { SchemaSnapshot } from "./snapshot.ts";
import {
  column,
  foreignKey,
  namespace,
  sequence,
  snapshot,
  table,
} from "./testing.ts";

const GOLDEN = snapshot(
  namespace("app", {
    tables: [
      table("users", {
        columns: [column("id", "integer", { nullable: false })],
        primaryKey: {
          name: "users_pkey",
          columns: ["id"],
          deferrable: "not-deferrable",
        },
      }),
    ],
    enums: [{ name: "mood", values: ["sad", "happy"] }],
  }),
);

// Format v1 is frozen: if this text changes, existing checksums break.
const GOLDEN_TEXT = `{
  "dialect": "postgresql",
  "formatVersion": 1,
  "namespaces": [
    {
      "enums": [
        {
          "name": "mood",
          "values": [
            "sad",
            "happy"
          ]
        }
      ],
      "name": "app",
      "sequences": [],
      "tables": [
        {
          "checkConstraints": [],
          "columns": [
            {
              "collation": null,
              "comment": null,
              "default": null,
              "generated": null,
              "identity": null,
              "name": "id",
              "nullable": false,
              "type": "integer"
            }
          ],
          "comment": null,
          "foreignKeys": [],
          "indexes": [],
          "name": "users",
          "primaryKey": {
            "columns": [
              "id"
            ],
            "deferrable": "not-deferrable",
            "name": "users_pkey"
          },
          "uniqueConstraints": []
        }
      ]
    }
  ]
}
`;

function sample(): SchemaSnapshot {
  return snapshot(
    namespace("public", {
      tables: [
        table("users", {
          columns: [
            column("id", "integer", { nullable: false }),
            column("email", "text"),
          ],
          primaryKey: {
            name: "users_pkey",
            columns: ["id"],
            deferrable: "not-deferrable",
          },
          uniqueConstraints: [
            {
              name: "users_email_key",
              columns: ["email"],
              nullsNotDistinct: false,
              deferrable: "not-deferrable",
            },
          ],
          indexes: [
            {
              name: "users_b_idx",
              unique: false,
              definition:
                "CREATE INDEX users_b_idx ON public.users USING btree (email)",
            },
            {
              name: "users_a_idx",
              unique: false,
              definition:
                "CREATE INDEX users_a_idx ON public.users USING btree (id)",
            },
          ],
        }),
        table("orders", {
          columns: [
            column("id", "integer", { nullable: false }),
            column("user_id", "integer"),
          ],
          foreignKeys: [
            foreignKey("orders_user_fkey", ["user_id"], {
              namespace: "public",
              table: "users",
              columns: ["id"],
            }),
          ],
        }),
      ],
      enums: [{ name: "status", values: ["new", "done"] }],
      sequences: [
        sequence("orders_id_seq", {
          ownedBy: { table: "orders", column: "id" },
        }),
      ],
    }),
    namespace("audit"),
  );
}

/** Same content as sample(), built in a different order with differently ordered keys. */
function shuffledSample(): SchemaSnapshot {
  const original = sample();
  const publicNamespace = original.namespaces[0]!;
  const reversedTables = [...publicNamespace.tables].reverse().map((t) => ({
    comment: t.comment,
    indexes: [...t.indexes].reverse(),
    foreignKeys: t.foreignKeys,
    checkConstraints: t.checkConstraints,
    uniqueConstraints: t.uniqueConstraints,
    primaryKey: t.primaryKey,
    columns: t.columns,
    name: t.name,
  }));
  return {
    namespaces: [
      namespace("audit"),
      { ...publicNamespace, tables: reversedTables },
    ],
    dialect: "postgresql",
    formatVersion: 1,
  };
}

describe("serializeSnapshot", () => {
  it("matches the frozen format v1 text", () => {
    assert.equal(serializeSnapshot(GOLDEN), GOLDEN_TEXT);
  });

  it("produces identical bytes regardless of input order", () => {
    assert.equal(
      serializeSnapshot(shuffledSample()),
      serializeSnapshot(sample()),
    );
  });

  it("keeps column, enum value and key column order", () => {
    const parsed = JSON.parse(
      serializeSnapshot(
        snapshot(
          namespace("app", {
            tables: [
              table("t", {
                columns: [column("z", "integer"), column("a", "integer")],
                primaryKey: {
                  name: "t_pkey",
                  columns: ["z", "a"],
                  deferrable: "not-deferrable",
                },
              }),
            ],
            enums: [{ name: "e", values: ["zeta", "alpha"] }],
          }),
        ),
      ),
    ) as SchemaSnapshot;
    const ns = parsed.namespaces[0]!;
    assert.deepEqual(
      ns.tables[0]!.columns.map((c) => c.name),
      ["z", "a"],
    );
    assert.deepEqual(ns.tables[0]!.primaryKey!.columns, ["z", "a"]);
    assert.deepEqual(ns.enums[0]!.values, ["zeta", "alpha"]);
  });

  it("sorts names by code unit, not by locale", () => {
    const names = ["b", "é", "a", "_x", "B"];
    const sorted = canonicalizeSnapshot(
      snapshot(...names.map((name) => namespace(name))),
    ).namespaces.map((ns) => ns.name);
    assert.deepEqual(sorted, ["B", "_x", "a", "b", "é"]);
    assert.deepEqual([...names].sort(compareNames), sorted);
  });
});

describe("snapshotChecksum", () => {
  it("is the SHA-256 of the serialized bytes", async () => {
    const expected = createHash("sha256")
      .update(serializeSnapshot(GOLDEN))
      .digest("hex");
    assert.equal(await snapshotChecksum(GOLDEN), `sha256:${expected}`);
    assert.equal(
      await snapshotChecksum(GOLDEN),
      "sha256:054556f6c681e0ea9e28a42f6fcb4c79337a42b23f7ad76b13a7bc68f40aefb1",
    );
  });

  it("is stable across input order and changes with content", async () => {
    assert.equal(
      await snapshotChecksum(shuffledSample()),
      await snapshotChecksum(sample()),
    );
    const changed = sample();
    changed.namespaces[0]!.tables[0]!.columns[1]!.nullable = false;
    assert.notEqual(
      await snapshotChecksum(changed),
      await snapshotChecksum(sample()),
    );
  });
});

describe("canonicalizeSnapshot", () => {
  it("does not mutate its input", () => {
    const input = shuffledSample();
    const before = JSON.stringify(input);
    canonicalizeSnapshot(input);
    assert.equal(JSON.stringify(input), before);
  });

  it("rejects another format version", () => {
    const input = { ...GOLDEN, formatVersion: 2 } as unknown as SchemaSnapshot;
    assert.throws(() => canonicalizeSnapshot(input), SnapshotValidationError);
  });

  const invalid: [string, SchemaSnapshot][] = [
    ["duplicate namespaces", snapshot(namespace("app"), namespace("app"))],
    [
      "duplicate tables",
      snapshot(namespace("app", { tables: [table("t"), table("t")] })),
    ],
    [
      "duplicate columns",
      snapshot(
        namespace("app", {
          tables: [
            table("t", { columns: [column("a", "text"), column("a", "text")] }),
          ],
        }),
      ),
    ],
    [
      "constraint names shared across kinds",
      snapshot(
        namespace("app", {
          tables: [
            table("t", {
              columns: [column("a", "text")],
              primaryKey: {
                name: "dup",
                columns: ["a"],
                deferrable: "not-deferrable",
              },
              checkConstraints: [{ name: "dup", expression: "(a <> '')" }],
            }),
          ],
        }),
      ),
    ],
    [
      "duplicate enum values",
      snapshot(
        namespace("app", { enums: [{ name: "e", values: ["x", "x"] }] }),
      ),
    ],
    [
      "a key on an unknown column",
      snapshot(
        namespace("app", {
          tables: [
            table("t", {
              primaryKey: {
                name: "t_pkey",
                columns: ["missing"],
                deferrable: "not-deferrable",
              },
            }),
          ],
        }),
      ),
    ],
    [
      "a foreign key with mismatched column counts",
      snapshot(
        namespace("app", {
          tables: [
            table("t", {
              columns: [column("a", "integer")],
              foreignKeys: [
                foreignKey("t_fkey", ["a"], {
                  namespace: "app",
                  table: "u",
                  columns: ["x", "y"],
                }),
              ],
            }),
          ],
        }),
      ),
    ],
    [
      "a sequence owned by an unknown column",
      snapshot(
        namespace("app", {
          sequences: [sequence("s", { ownedBy: { table: "t", column: "id" } })],
        }),
      ),
    ],
  ];
  for (const [name, input] of invalid) {
    it(`rejects ${name}`, () => {
      assert.throws(() => canonicalizeSnapshot(input), SnapshotValidationError);
    });
  }
});
