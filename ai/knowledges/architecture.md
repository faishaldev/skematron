# Architecture

Status as of 2026-10-10: pre-alpha. The repository contains libraries only. Nothing is deployed, and there is no CLI or web app yet.

## Packages

| Package | Path | Purpose | May import |
| --- | --- | --- | --- |
| `@skematron/core` | `packages/core` | Snapshot model, canonical form and checksum, migration planning. Pure and deterministic. | Only its own modules |
| `@skematron/adapters` | `packages/adapters` | Database adapters. Today: PostgreSQL introspection and SQL rendering. | Its own modules and `@skematron/core` |

`@skematron/core/testing` exports snapshot builders. It is for tests only.

The following are planned (AGENTS.md "Suggested Repository Layout") but not built yet:

- `apps/web`: dashboard, API, metadata database through Prisma, entitlements
- `apps/cli`
- `packages/storage`: artifact store
- `packages/contracts`
- schema-tool adapters: Prisma Schema, SQL DDL

## Data flow

```text
PostgreSQL database
   │  introspectPostgres(session)      read-only transaction, pg_catalog only, always rolled back
   ▼
SchemaSnapshot + unsupported[]         what was captured, and what was reported but not captured
   │  canonicalizeSnapshot / serializeSnapshot / snapshotChecksum
   ▼
canonical JSON (format v1) + sha256    the identity of a schema version
   │  planMigration(from, to)          pure; matches objects by name
   ▼
MigrationPlan                          ordered operations with risk and warnings, plus unsupported changes
   │  renderPostgresMigration(plan)    produces text; executes nothing
   ▼
SQL statements + review script
```

Nothing in this flow writes to a user database. Applying a plan will be a separate, explicitly authorized step (AGENTS.md "Schema and Migration Rules"). DDL export is the plan from `emptySnapshot("postgresql")` to a snapshot.

## Boundaries

- Core has no I/O and no dependencies. Checksums use Web Crypto, so core can run anywhere.
- Adapters do not own connections. The caller passes a `PostgresSession`: any object with `query(text)`, such as a `pg.Client`. Connection policy (credentials, TLS, SSRF rules) therefore stays with the app that owns the connection.
- Edition, entitlement and billing logic never goes into core or adapters (see `business-model.md`).
- The `boundaries.test.ts` file in each package enforces these import rules.

## Tooling

- Node 24 runs TypeScript directly through type stripping, so there is no build step. `tsc` only type-checks.
- Packages export `src/index.ts` directly.
- Tests use `node:test`. Integration tests need `SKEMATRON_TEST_DATABASE_URL`; `pnpm db:test:start` runs a disposable local PostgreSQL (`scripts/test-postgres.sh`).
- `scripts/sync-ai.ts` copies `ai/skills` into `.claude/skills` and `.codex/skills`.
- `scripts/check-docs.ts` is the documentation gate that `pnpm check` runs.
