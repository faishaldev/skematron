# Snapshot format

A snapshot describes the structure of a database schema, never its data. Snapshots will become Skematron's immutable schema versions, so the format and its checksum must stay stable.

## Format version 1

Defined in `packages/core/src/snapshot.ts`. The TypeScript types are the source of truth; this page summarizes them.

```text
SchemaSnapshot   formatVersion: 1, dialect: "postgresql", namespaces[]
Namespace        name, tables[], enums[], sequences[]
Table            name, columns[] (ordinal order), primaryKey | null, uniqueConstraints[],
                 checkConstraints[], foreignKeys[], indexes[], comment
Column           name, type, nullable, default, identity ("always" | "by-default" | null),
                 generated ({ kind: "stored" | "virtual", expression } | null), collation, comment
PrimaryKey       name, columns[], deferrable
UniqueConstraint name, columns[], nullsNotDistinct, deferrable
CheckConstraint  name, expression
ForeignKey       name, columns[], references { namespace, table, columns[] },
                 onUpdate, onDelete, matchFull, deferrable
Index            name, unique, definition       (only indexes that do not back a constraint)
EnumType         name, values[] (sort order)
Sequence         name, dataType, start, increment, minValue, maxValue, cache, cycle,
                 ownedBy { table, column } | null
```

Details:

- `deferrable` is one of `not-deferrable`, `deferrable`, `deferrable-initially-deferred`.
- Referential actions are `no-action`, `restrict`, `cascade`, `set-null`, `set-default`.
- Sequence numbers are decimal strings, so 64-bit values stay exact.
- Types, defaults, expressions, collations and index definitions are SQL fragments, stored exactly as the source engine printed them. For PostgreSQL they are schema-qualified because introspection runs with an empty `search_path`.

## Canonical form

`canonicalizeSnapshot` validates and normalizes the snapshot:

- Every object is rebuilt with exactly the fields above, so extra properties are dropped.
- Named collections are sorted by name using UTF-16 code-unit comparison: namespaces, tables, enums, sequences, unique/check constraints, foreign keys and indexes.
- These keep their original order because the order is meaningful: columns (ordinal position), enum values, and the key columns of constraints.
- Validation rejects:
  - duplicate names in any collection, where constraint names share one space per table
  - duplicate enum values
  - keys or owners that reference unknown columns
  - foreign keys whose column count differs from the referenced columns
  - any `formatVersion` other than 1

## Serialization and checksum

- `serializeSnapshot` produces the canonical form as JSON: object keys sorted recursively by code unit, 2-space indentation, `\n` at the end.
- `snapshotChecksum` is `"sha256:" + hex(SHA-256(UTF-8 bytes of the serialization))`, computed with Web Crypto.
- Store snapshots as exactly these bytes. The artifact checksum and the snapshot checksum are then the same value.
- The golden test in `packages/core/src/canonical.test.ts` pins the v1 text and one checksum (`sha256:054556f6…aefb1`).

## Identity vs. equivalence

- **Identity:** equal checksums mean byte-identical snapshots.
- **Equivalence:** `isEmptyPlan(planMigration(a, b))`. The planner ignores column position, because PostgreSQL cannot reorder columns. A database migrated by appending a column is equivalent to one created with that column in the middle, but its checksum differs.
- To verify that a database reached its intended state, compare for equivalence, not checksums.

## Not in a snapshot

- Table data, and any state derived from it:
  - a sequence's current value
  - constraint validation state (`NOT VALID`)
  - statistics
- Ownership, grants and other privileges.
- Tablespaces and storage parameters.
- Identity columns' sequence options.
- Everything that `postgresql-support.md` lists as unsupported. Introspection reports those objects separately.

## Versioning policy

- Never change the canonicalization or serialization of an existing format version.
- Any change to the shape (fields added, removed, renamed or retyped) needs all of the following:
  - a new `formatVersion`
  - a way to read older versions, without rewriting stored artifacts
  - a new golden test
  - updates to this page and to `decisions.md`
