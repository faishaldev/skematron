# Architecture

Status as of 2026-10-10: pre-alpha.

- **What exists:** two libraries, an artifact store, and the first dashboard (single-organization mode).
- **Not built yet:** the CLI, deployment packaging, and an apply step.

## Packages and apps

| Package | Path | Purpose | May import |
| --- | --- | --- | --- |
| `@skematron/core` | `packages/core` | Snapshot model, canonical form and checksum, migration planning. Pure and deterministic. | Only its own modules |
| `@skematron/adapters` | `packages/adapters` | Database adapters. Today: PostgreSQL introspection and SQL rendering. | Its own modules and `@skematron/core` |
| `@skematron/storage` | `packages/storage` | Content-addressed, checksum-verified artifact files (key = `sha256:<hex>`). | Node built-ins and its own modules |
| `@skematron/web` | `apps/web` | The dashboard: Next.js 16, Better Auth, Prisma 7 against the metadata database. | Everything above, plus `pg`, Next.js, React, Better Auth, Prisma |

`@skematron/core/testing` exports snapshot builders. It is for tests only.

## The dashboard (`apps/web`)

- **Single-organization mode.**
  - First-run setup (`/setup`) creates the installation's one organization and its owner. The `installation` row, `id = 1`, records it.
  - After that, sign-up is invitation-only: invitation links on `/settings/members`, with no email.
- **Roles and permissions:** `lib/roles.ts` is the single source.

  | Action | viewer | member | admin | owner |
  | --- | --- | --- | --- | --- |
  | View projects, versions, compare, export | ✓ | ✓ | ✓ | ✓ |
  | Import versions, test connections, check drift | | ✓ | ✓ | ✓ |
  | Create and edit projects and environments | | | ✓ | ✓ |
  | Invite members, change roles, remove members, view the audit log | | | ✓ | ✓ |

  Nobody can assign the owner role or change the owner.
- **Projects** contain **environments** and **schema versions**.
  - An environment is a database target. Its URL is stored only encrypted; `connectionHint` is the redacted form.
  - Importing introspects the environment's tracked schemas, read-only:
    - The snapshot is stored as an artifact.
    - A `schema_version` row is added, numbered per project under an advisory lock.
    - An import identical to the latest version creates nothing.
- **Pages:**
  - `/projects`, `/projects/[project]`
  - `/projects/[project]/environments/{new,[environment]}`
  - `/projects/[project]/versions/[n]`, with `export.sql` and `snapshot.json` downloads
  - `/projects/[project]/compare?from=&to=` between two versions, or `?from=&environment=` for drift
  - `/settings/members`, `/settings/audit`
- **Server modules (`apps/web/lib`):**
  - `session.ts`: actor and permission guards
  - `auth.ts`: Better Auth config
  - `membership.ts`: the sign-up gate and invitations
  - `members.ts`
  - `projects.ts`: projects and environments
  - `targets.ts`: the only module that decrypts and connects
  - `versions.ts`
  - `audit.ts`
  - `secrets.ts`, `connections.ts`, `roles.ts`, `slugs.ts`
  - `env.ts`, `db.ts`
  - `actions.ts`: the server-action wrapper

## The metadata database

- **What it is:** PostgreSQL with Prisma 7. The schema is `prisma/schema.prisma`, migrations are in `prisma/migrations`, and the config is `prisma.config.ts`. The generated client goes to `apps/web/generated/prisma`.
- **Tables:**
  - Better Auth: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`.
  - Skematron: `installation`, `project`, `environment`, `schema_version`, `audit_event`.
- **Artifacts** live outside the database, in `SKEMATRON_ARTIFACT_DIR`. Back up the database, the artifacts and `SKEMATRON_SECRET_KEY` together.

## Data flow

```text
PostgreSQL database (an environment)
   │  introspectPostgres(session)      read-only transaction, pg_catalog only, always rolled back
   ▼
SchemaSnapshot + unsupported[]         what was captured, and what was reported but not captured
   │  canonicalizeSnapshot / serializeSnapshot / snapshotChecksum
   ▼
canonical JSON (format v1) + sha256    stored as an artifact; recorded as schema version N
   │  planMigration(from, to)          pure; versions or live drift; matches objects by name
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

- **Core** has no I/O and no dependencies. Checksums use Web Crypto, so core can run anywhere.
- **Adapters do not own connections.** The caller passes a `PostgresSession` (any object with `query(text)`, such as a `pg.Client`). In the dashboard, `lib/targets.ts` owns connection policy (decryption, timeouts, error messages).
- **Connection URLs, passwords and decrypted secrets never reach the browser,** the HTML, logs, audit details or error messages.
- **Edition, entitlement and billing logic** never goes into core, adapters or storage (see `business-model.md`).
- **Import rules** are enforced by the `boundaries.test.ts` file in each package.

### Planned, not built yet

- **Hosted SaaS mode:** several organizations, an SSRF guard for user-supplied hosts, quotas, entitlements and billing.
- **`apps/cli`,** with API tokens.
- **Saved plans, review and approvals, then apply.**
- **Schema-tool adapters:** Prisma Schema, SQL DDL.
- **Docker Compose** packaging.

## Tooling

- **TypeScript:**
  - Node 24 runs TypeScript directly through type stripping, so the packages have no build step. `tsc` only type-checks.
  - The web app is compiled by Next.js, which transpiles the workspace packages.
  - `pnpm typecheck` runs the root `tsc`, then `next typegen && tsc` for the app.
- **The local database:** `pnpm db:start` (`scripts/local-postgres.sh`) runs a disposable local PostgreSQL in `.local/`.
  - It holds the `skematron` database (metadata) and `skematron_test` (tests and the `demo` schema).
  - It adds any missing `.env` keys.
  - `pnpm db:seed [v1|v2]` loads the demo schema.
  - `pnpm db:migrate`, `db:deploy` and `db:generate` wrap Prisma.
- **Tests:** `node:test`, including metadata integration tests in a throwaway `skematron_it_*` database.
- **Example:** `packages/adapters/examples/export-schema.ts` (`pnpm example:export`) uses the libraries without the dashboard.
- **Docs tooling:**
  - `scripts/sync-ai.ts` copies `ai/skills` into `.claude/skills` and `.codex/skills`.
  - `scripts/check-docs.ts` is the documentation gate that `pnpm check` runs.
