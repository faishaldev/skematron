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

**Schema-tool adapter.** Imports or exports a schema format. Today: Prisma Schema (`preparePrismaSchema`, which prepares a `schema.prisma` for Prisma's own CLI). SQL from any other tool goes through the PostgreSQL adapter's script reader (`preparePostgresScript`) instead.

**SQL script.** PostgreSQL SQL uploaded to the dashboard. It is either the whole schema (from an empty database: `pg_dump --schema-only`, `drizzle-kit export`, `alembic upgrade head --sql`) or changes only (migrations, run on top of the version they start from). Only its checksum is kept, never the script.

**Migration history table.** The table a migration tool keeps to remember which migrations ran, such as `_prisma_migrations` or `alembic_version`. Skematron leaves these out of schemas it reads from outside and lists them as not tracked.

**Intended vs. observed state.** The intended state is the snapshot a team wants a database to have. The observed state is what introspection reads from that database now. Skematron keeps the two separate (AGENTS.md).

**Installation.** One self-hosted deployment of Skematron. In single-organization mode it owns exactly one organization, recorded in the `installation` row (`id = 1`) by first-run setup.

**Organization, member, role.** The people who use an installation. Each member has one role: viewer, member, admin or owner (see `architecture.md` for what each may do).

**Project.** A schema being tracked, such as one application's database. It holds environments and versions.

**Environment.** A database a project reads, such as `production` or `staging`. It stores an encrypted connection URL, a redacted `connectionHint`, and the schemas (namespaces) to track. Skematron only introspects it, read-only.

**Schema version.** An immutable, numbered snapshot of a project's schema (v1, v2, …), imported from an environment, a SQL script or a `schema.prisma`, or merged from a branch. It records provenance (environment and server version, the SQL script's checksum, or Prisma version and schema file checksum) and the objects not captured.

**Artifact.** A file in the artifact store (`@skematron/storage`), named by the SHA-256 of its bytes. A schema version's checksum is its artifact key.

**Drift.** The difference between an environment's live schema and a version: `planMigration(version, live)`. No drift means they are equivalent.

**Audit event.** A record of a privileged action (setup, invitations, role changes, project and environment changes, imports). It never contains secrets.

**Export (DDL).** The SQL that creates a snapshot from nothing: `renderPostgresMigration(planMigration(emptySnapshot("postgresql"), snapshot))`.

**Question.** Something the planner cannot decide from two snapshots alone: whether a missing table, column or sequence was renamed (`rename-*`), or what existing rows get in a new NOT NULL column (`backfill`). Each has a stable id. See `packages/core/src/questions.ts`.

**Answer.** A person's decision on a question: `rename` to a candidate or `drop`; a backfill `value` or `skip`. Answers are keyed by question id and stored with each migration revision.

**Main.** A project's line of immutable, numbered schema versions (v1, v2, …): the agreed schema. After the baseline, it grows only by merging branches.

**Baseline.** The first version on main, imported from a SQL script, a `schema.prisma` or a database. It is the only version that does not come from a branch.

**Branch.** A proposed change to the schema, shared with the team. It starts from the latest version on main (its base) with a copy of its schema (its head), which people change with the schema editor or by uploading SQL (the whole schema or migrations) or a `schema.prisma`. It is open until it is merged or closed.

**Merge.** Recording an approved branch's head as the next version on main. It is refused if main moved on, or if the branch changed after its approval.

**Rebase.** Moving a branch's base to the latest version on main, when main moved on while the branch was open. The head stays, so the changes are shown against the newer version and need a new test and review.

**Close.** Ending a branch without recording anything on main.

**Migration.** The review of a branch: the change from its base to its head, with a status: draft, in review, approved or rejected. Each test run adds a revision.

**Revision.** One immutable test run of a branch: its answers, the plan, the SQL script and the head it planned towards (artifacts), the risk summary and the shadow verification result.

**Shadow database.** A temporary `skematron_shadow_*` database on a dedicated server (`SKEMATRON_SHADOW_DATABASE_URL`), where Skematron runs uploaded SQL scripts and Prisma's DDL, and checks migration plans. It is dropped after each run and never holds user data.

**Verification.** Recreating the `from` version in a shadow database, running a plan there statement by statement, and checking that the result matches the `to` version. Result: passed, failed or unavailable. The dashboard calls it the "test run".

**Four-eyes review.** A branch is approved or rejected by an admin or owner who did not work on it (did not create, change, rebase or test it).

**Schema source.** Where a project's schema is written: "code" (a `schema.prisma`, or the database itself; branches get uploads) or "dashboard" (branches are changed in the schema editor). One project has one source, so there are never two sources of truth.
