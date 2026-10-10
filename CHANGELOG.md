# Changelog

All notable changes to Skematron are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `pnpm check` requires an entry for every change to source, scripts or configuration.

## [Unreleased]

### Added

- **Workspace.**
  - A pnpm monorepo on Node 24 that runs TypeScript natively, with no build step.
  - `node:test` for tests, `tsc` for type checks, Prettier for TS, JSON and YAML.
  - `pnpm check` runs all of these.
- **`@skematron/core` snapshot format v1.**
  - Describes namespaces, tables, columns, primary keys, unique, check and foreign key constraints, indexes, enums and sequences.
  - Validated canonical form and canonical JSON serialization.
  - `sha256:` checksums computed with Web Crypto.
- **`@skematron/core` `planMigration`.**
  - Compares two snapshots and returns ordered operations, each with a `safe`, `caution` or `destructive` risk level and warnings.
  - Lists differences it cannot express (such as removed enum values or changed generated columns) instead of skipping them.
- **`@skematron/adapters` `introspectPostgres`.**
  - Reads a PostgreSQL 14+ schema in a read-only transaction that is always rolled back. It queries only the system catalog.
  - Pins session settings so snapshots are deterministic.
  - Reports views, functions, triggers, partitioned tables and other objects it does not capture.
- **`@skematron/adapters` `renderPostgresMigration`.**
  - Turns a plan into SQL statements and a review script that summarizes unsupported changes and destructive operations.
  - Identifiers are always quoted, and `CASCADE` is never rendered.
- **Tests.**
  - Unit tests for canonicalization, planning, rendering and introspection.
  - PostgreSQL integration tests: exported DDL recreates an identical checksum, and a v1 → v2 migration reaches an equivalent schema.
  - Dashboard tests:
    - unit tests for permissions, encryption, URL validation and redaction
    - integration tests against a throwaway metadata database: the sign-up gate, invitations, organization scoping, encrypted storage, and concurrent version numbering
- **Local PostgreSQL (`pnpm db:start` / `db:stop`).**
  - A disposable, socket-only cluster in `.local/`, with a metadata database (`skematron`) and a test database (`skematron_test`).
  - It adds missing `.env` keys with generated secrets.
  - The earlier `db:test:*` names still work.
- **Dashboard (`apps/web`, `pnpm web`)**, built on Next.js 16, Better Auth and Prisma 7. It runs in single-organization mode for self-hosting:
  - **Accounts:** first-run setup at `/setup` creates the organization and its owner. After that, people join only through invitation links.
  - **Roles:** viewer, member, admin and owner, enforced on the server for every page, action and download. Admins manage members on the Members page.
  - **Projects and environments:** an environment is a database target. Its connection URL is stored encrypted (AES-256-GCM) and only ever shown redacted.
  - **Importing:** reads a version from an environment, read-only. Versions are immutable, numbered per project, and stored as checksum-verified artifacts. An unchanged schema creates no new version.
  - **Comparing:** browse any version, compare two versions, or check an environment for drift as a risk-rated migration. Export SQL or the snapshot JSON.
  - **Audit log:** setup, invitations, role changes, project and environment changes, and imports.
- **Metadata database** for Skematron's own data (`prisma/`): `pnpm db:migrate` in development, `pnpm db:deploy` in production. `docs/self-hosting.md` covers configuration, backups and upgrades.
- **`@skematron/storage`:** a content-addressed artifact store whose writes are atomic and never overwrite, and whose reads are verified against their checksum.
- **`pnpm db:seed v2`** loads the changed sample schema, so you can try Compare.
- **Try the libraries without the dashboard.**
  - `pnpm db:seed` loads a sample `demo` schema into the test database.
  - `pnpm example:export [schema…]` reads a schema (read-only) and prints its checksum, the objects it could not capture, and the SQL that recreates it. Set `DATABASE_URL` to read your own database instead.
- **AI docs** for Claude Code, Codex and other agents:
  - rules in `ai/rules/`
  - skills in `ai/skills/` (`documenting-changes`, `extending-postgres-support`), copied to `.claude/skills` and `.codex/skills` by `pnpm sync:ai`
  - knowledges in `ai/knowledges/`
- **Documentation gate (`pnpm check:docs`).** Fails when source changes lack a CHANGELOG entry or when the skill copies drift from `ai/skills`.
