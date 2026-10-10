# Architecture

Status as of 2026-10-10: pre-alpha. The repository contains two libraries and a local, read-only schema viewer. Nothing is deployed, there is no CLI, and the product dashboard has not been built.

## Packages and apps

| Package | Path | Purpose | May import |
| --- | --- | --- | --- |
| `@skematron/core` | `packages/core` | Snapshot model, canonical form and checksum, migration planning. Pure and deterministic. | Only its own modules |
| `@skematron/adapters` | `packages/adapters` | Database adapters. Today: PostgreSQL introspection and SQL rendering. | Its own modules and `@skematron/core` |
| `@skematron/web` | `apps/web` | Local, read-only schema viewer (Next.js 16): browse, export, save snapshots, compare. No login; binds to `127.0.0.1`. | Core, adapters, `pg`, Next.js and React |

`@skematron/core/testing` exports snapshot builders. It is for tests only.

### The viewer

- **Pages:**
  - `/`: the schemas and the saved snapshots.
  - `/schema?ns=`: browse one schema.
  - `/export?ns=`: export SQL.
  - `/export/sql?ns=`: download the export SQL.
  - `/compare?ns=&snapshot=`: compare the live schema with a saved snapshot.
- **Server-side code:** all database access goes through `apps/web/lib/server.ts` (server-only).
- **Saving:** the "Save snapshot" server action writes to the snapshot store (`apps/web/lib/snapshots.ts`), as immutable, checksum-verified files in `.local/snapshots`.
- **Compare** shows `planMigration(saved, live)`: the migration from the snapshot to the current schema.

### Planned, not built yet

See AGENTS.md "Suggested Repository Layout".

- **The product dashboard:** authentication, organizations and projects, a metadata database through Prisma, entitlements. It may grow out of `apps/web`, but authorization comes first.
- **`apps/cli`**
- **`packages/storage`:** the artifact store. The viewer's snapshot store is its local precursor.
- **`packages/contracts`**
- **Schema-tool adapters:** Prisma Schema, SQL DDL.

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

- Nothing in this flow writes to a user database.
- Applying a plan will be a separate, explicitly authorized step (AGENTS.md "Schema and Migration Rules").
- DDL export is the plan from `emptySnapshot("postgresql")` to a snapshot.

## Boundaries

- Core has no I/O and no dependencies. Checksums use Web Crypto, so core can run anywhere.
- Adapters do not own connections. The caller passes a `PostgresSession`: any object with `query(text)`, such as a `pg.Client`. Connection policy (credentials, TLS, SSRF rules) therefore stays with the app that owns the connection; in the viewer, that is `lib/server.ts`.
- The connection URL never reaches the browser. Pages see only a `source` label.
- Edition, entitlement and billing logic never goes into core or adapters (see `business-model.md`).
- The `boundaries.test.ts` file in each package enforces the packages' import rules.

## Tooling

- **TypeScript:**
  - Node 24 runs TypeScript directly through type stripping, so the packages have no build step. `tsc` only type-checks.
  - Packages export `src/index.ts` directly.
  - The web app is compiled by Next.js, which transpiles the workspace packages (`transpilePackages`).
  - `pnpm typecheck` runs the root `tsc`, then `next typegen && tsc` for the app.
- **Tests and the test database:**
  - Tests use `node:test`.
  - Integration tests need `SKEMATRON_TEST_DATABASE_URL`. `pnpm db:test:start` runs a disposable local PostgreSQL (`scripts/test-postgres.sh`).
  - `pnpm db:test:seed [v1|v2]` loads `fixtures/v1.sql` or `fixtures/v2.sql` as a `demo` schema into that test database.
- **Trying it by hand:**
  - `packages/adapters/examples/export-schema.ts` (`pnpm example:export`) shows the library in use: introspect, checksum, then export DDL. It sits outside `src/` and is not part of the package API.
  - `pnpm web` runs the viewer's dev server on port 3100.
- **Docs tooling:**
  - `scripts/sync-ai.ts` copies `ai/skills` into `.claude/skills` and `.codex/skills`.
  - `scripts/check-docs.ts` is the documentation gate that `pnpm check` runs.
