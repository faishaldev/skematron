# Glossary

**Snapshot.** A description of a database schema's structure: namespaces, tables, columns, constraints, indexes, enums and sequences. It never contains data. Type: `SchemaSnapshot` in `packages/core/src/snapshot.ts`.

**Namespace.** A schema in the database engine's sense, created with PostgreSQL `CREATE SCHEMA`. Skematron says "namespace" because "schema" also means the whole structure.

**Format version.** The version of the snapshot document shape (`formatVersion`, currently 1). See `snapshot-format.md`.

**Canonical form.** A snapshot rebuilt with a fixed set of fields, with named collections sorted by name using code-unit order. The same schema always produces the same canonical form.

**Checksum.** `sha256:<hex>` of the canonical JSON bytes. It identifies an exact snapshot. Equal checksums mean identical snapshots.

**Equivalent.** Two snapshots are equivalent when `planMigration` between them returns an empty plan. Equivalent snapshots can still have different checksums, for example when column order differs.

**Migration plan.** The ordered list of operations that turns one snapshot into another, plus any unsupported changes. Type: `MigrationPlan`. It is pure data; it executes nothing.

**Operation.** One step of a plan, such as `add-column` or `drop-table`. Each operation has a risk level and warnings, and renders to one SQL statement.

**Risk.**

- `safe`: not expected to fail or lose data.
- `caution`: may fail on existing data or take heavy locks, but loses no data.
- `destructive`: may permanently lose data.

**Unsupported change.** A difference between two snapshots that the planner cannot express, such as removing an enum value. A plan with unsupported changes is incomplete.

**Unsupported object.** Something that exists in the database but is not captured in the snapshot, such as a view or a trigger. Introspection reports it instead of silently ignoring it.

**Session.** The single, dedicated database connection a caller passes to an adapter (`PostgresSession`).

**Database adapter.** Connects to a database engine through a session, reads schema metadata and renders SQL for that engine. Example: PostgreSQL.

**Schema-tool adapter** (planned). Imports or exports a schema format, such as Prisma Schema or SQL DDL.

**Intended vs. observed state.** The intended state is the snapshot a team wants a database to have. The observed state is what introspection reads from that database now. Skematron keeps the two separate (AGENTS.md).

**Saved snapshot.** A snapshot that the local viewer stored as an immutable file in `.local/snapshots`, with metadata (schema, time, checksum, source). It is verified against its checksum whenever it is loaded. "Compare" plans from a saved snapshot to the live schema.

**Export (DDL).** The SQL that creates a snapshot from nothing: `renderPostgresMigration(planMigration(emptySnapshot("postgresql"), snapshot))`.
