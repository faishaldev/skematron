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
- **Test database.** `pnpm db:test:start` / `pnpm db:test:stop` run a disposable, socket-only PostgreSQL cluster in `.local/` for integration tests.
- **AI docs** for Claude Code, Codex and other agents:
  - rules in `ai/rules/`
  - skills in `ai/skills/` (`documenting-changes`, `extending-postgres-support`), copied to `.claude/skills` and `.codex/skills` by `pnpm sync:ai`
  - knowledges in `ai/knowledges/`
- **Documentation gate (`pnpm check:docs`).** Fails when source changes lack a CHANGELOG entry or when the skill copies drift from `ai/skills`.
