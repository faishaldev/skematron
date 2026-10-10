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

**Installation.** One self-hosted deployment of Skematron. In single-organization mode it owns exactly one organization, recorded in the `installation` row (`id = 1`) by first-run setup.

**Organization, member, role.** The people who use an installation. Each member has one role: viewer, member, admin or owner (see `architecture.md` for what each may do).

**Project.** A schema being tracked, such as one application's database. It holds environments and versions.

**Environment.** A database a project reads, such as `production` or `staging`. It stores an encrypted connection URL, a redacted `connectionHint`, and the schemas (namespaces) to track. Skematron only introspects it, read-only.

**Schema version.** An immutable, numbered snapshot of a project's schema (v1, v2, …), imported from an environment. It records provenance (environment, server version) and the objects not captured.

**Artifact.** A file in the artifact store (`@skematron/storage`), named by the SHA-256 of its bytes. A schema version's checksum is its artifact key.

**Drift.** The difference between an environment's live schema and a version: `planMigration(version, live)`. No drift means they are equivalent.

**Audit event.** A record of a privileged action (setup, invitations, role changes, project and environment changes, imports). It never contains secrets.

**Export (DDL).** The SQL that creates a snapshot from nothing: `renderPostgresMigration(planMigration(emptySnapshot("postgresql"), snapshot))`.
