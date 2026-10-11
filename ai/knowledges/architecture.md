# Architecture

Status as of 2026-10-10: pre-alpha.

- **What exists:** two libraries, an artifact store, and the dashboard (single-organization mode) with versions, Prisma schema import, and migrations that are planned with guided questions, checked in a shadow database and reviewed by a second person.
- **Not built yet:** applying migrations to environments (Phase 1b), the CLI, and deployment packaging.

## Packages and apps

| Package | Path | Purpose | May import |
| --- | --- | --- | --- |
| `@skematron/core` | `packages/core` | Snapshot model, canonical form and checksum, schema editing, migration planning. Pure and deterministic. | Only its own modules |
| `@skematron/adapters` | `packages/adapters` | Database adapter: PostgreSQL introspection and SQL rendering (`postgres/`). Schema-tool adapter: Prisma Schema preparation (`prisma/`). The two never import each other. | Its own modules and `@skematron/core` |
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
  | Import the baseline; start, change, test, submit, rebase, merge and close branches | | ✓ | ✓ | ✓ |
  | Change a project's schema source | | | ✓ | ✓ |
  | Approve or reject branches (never ones they worked on) | | | ✓ | ✓ |
  | Create and edit projects and environments | | | ✓ | ✓ |
  | Invite members, change roles, remove members, view the audit log | | | ✓ | ✓ |

  Nobody can assign the owner role or change the owner.
- **Projects** contain **environments**, **main** (the numbered, immutable schema versions) and **branches**.
  - An environment is a database target. Its URL is stored only encrypted; `connectionHint` is the redacted form.
  - Versions are stored as artifacts and recorded as `schema_version` rows, numbered per project under an advisory lock (`lib/versions.ts`).
- **Main grows in two ways only:**
  - **The baseline (v1):**
    - a `schema.prisma` import (`lib/prisma-import.ts`), or
    - the first import from an environment (`importEnvironment` in `lib/branches.ts`).
  - **Merged branches**, for everything after that.

  Later environment imports that differ from main become a new branch named `from-<environment>`, and an import equal to main creates nothing.
- **Branches** (`lib/branches.ts`, `branch` table):
  - **Contents:** a branch starts from the latest version on main (its base) with a copy of its schema (its head).
  - **Changing the head:**
    - The schema editor, for "dashboard" projects. Core's edit functions apply each edit (`lib/schema-edits.ts`, `edit.ts`), then `normalizeSnapshot` rebuilds the head in a shadow database.
    - Uploading a `schema.prisma`, for "code" projects: Prisma CLI, then shadow database.
  - Every change is refused if the branch changed since it was loaded (optimistic check on `updatedAt`), and sends the review back to draft.
  - **Shared:** the team sees branches, and members can edit them. Everyone who changes, rebases or tests a branch is recorded in `contributorIds`.
  - **Merge** records the head as the next version, in the same transaction as the branch's status change. It needs:
    - an approval of the latest test run, made after the branch's last change, for exactly this head (`toChecksum`)
    - main still at the branch's base
  - **Rebase** moves the base to the latest version. The head stays, so anything that would undo newer work on main shows up in the list. **Close** ends the branch without recording anything.
- **Schema source** (`project.schemaSource`):
  - "code": the baseline and branch contents come from `schema.prisma` uploads (or environment imports).
  - "dashboard": branch contents come from the schema editor.

  Prisma uploads work only for "code", and the editor only for "dashboard".
- **Migrations** (`lib/migrations.ts`) are the review of a branch (one per branch), from its base to its head:
  - **Content lives in immutable revisions.** Each test run makes one, and each stores:
    - the answers
    - the plan JSON, the SQL script and the head it planned towards, as artifacts
    - a risk summary
    - counts of open questions and unsupported changes
    - the shadow verification result: `passed`, `failed` or `unavailable`
  - **Status:** draft → in_review → approved or rejected. Any change to the branch, or a new test run, returns it to draft.
  - **Submit** needs changes, no open questions, no unsupported changes, and a passed test run made after the branch's last change.
  - **Review:**
    - Only an admin or owner who did not work on the branch may approve or reject.
    - Approving destructive operations needs an explicit acknowledgment. Rejecting needs a comment.
    - The reviewer approves the exact revision they saw.
- **The shadow database** (`lib/shadow.ts`, `SKEMATRON_SHADOW_DATABASE_URL`) is a dedicated, disposable server:
  - Each run creates a `skematron_shadow_<random>` database and always drops it. The role must not be a superuser.
  - Verification recreates the `from` version (plus the extensions it reports), runs the plan statement by statement, and requires the result to match `to`.
- **Pages:**
  - Every signed-in page has the sidebar (`app/(app)/layout.tsx`): a project switcher (with the list of all projects), the current project's sections (the last project opened when the page is outside a project), the workspace (members, audit log), and the account.
  - `/projects` (project cards), `/projects/new` (create a project and choose its schema source), `/projects/[project]` (overview: next step, counts, open branches, diagram of main)
  - `/projects/[project]/{branches,versions,diagram,environments,settings}`: the project's sections. `diagram` takes `?version=` or `?branch=`.
  - `/projects/[project]/environments/{new,[environment]}`
  - `/projects/[project]/versions/[n]` (diagram, or `?view=tables`), with `export.sql` and `snapshot.json` downloads, and `schema.prisma` for Prisma imports
  - `/projects/[project]/versions/new`: import the baseline `schema.prisma`
  - `/projects/[project]/branches/new`, `/projects/[project]/branches/[name]` (changes, questions, test run, review, merge, rebase, close; `migration.sql` download)
  - `/projects/[project]/branches/[name]/edit` (schema editor) and `/projects/[project]/branches/[name]/upload` (`schema.prisma`)
  - `/projects/[project]/compare?from=&to=` between two versions, or `?from=&environment=` for drift
  - `/settings/members`, `/settings/audit`
- **Server modules (`apps/web/lib`):**
  - `session.ts`: actor and permission guards
  - `auth.ts`: Better Auth config
  - `membership.ts`: the sign-up gate and invitations
  - `members.ts`
  - `projects.ts`: projects and environments
  - `targets.ts`: the only module that decrypts environment URLs and connects to user databases (read-only)
  - `shadow.ts`: temporary databases on the shadow server, `snapshotFromDdl`, `verifyMigration`
  - `prisma-import.ts`: runs the Prisma CLI in a temporary directory with a minimal environment
  - `branches.ts`: the branch workflow (create, edit, upload, import from a database, test, submit, review, rebase, merge, close)
  - `migrations.ts`: revisions, test runs and the review rules
  - `schema-edits.ts`: editor edits as data; `schema-input.ts`: checks for typed names, types and defaults
  - `versions.ts`
  - `audit.ts`
  - `secrets.ts`, `connections.ts`, `roles.ts`, `slugs.ts`
  - `env.ts`, `db.ts`
  - `actions.ts`: the server-action wrapper

## The metadata database

- **What it is:** PostgreSQL with Prisma 7. The schema is `prisma/schema.prisma`, migrations are in `prisma/migrations`, and the config is `prisma.config.ts`. The generated client goes to `apps/web/generated/prisma`.
- **Tables:**
  - Better Auth: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`.
  - Skematron: `installation`, `project`, `environment`, `schema_version`, `branch`, `migration`, `migration_revision`, `migration_review`, `audit_event`.
- **Artifacts** live outside the database, in `SKEMATRON_ARTIFACT_DIR`. Back up the database, the artifacts and `SKEMATRON_SECRET_KEY` together.

## Data flow

```text
PostgreSQL database (an environment)        schema.prisma
   │  introspectPostgres(session)                │  preparePrismaSchema → prisma migrate diff → DDL
   │  read-only, always rolled back              │  DDL runs in a shadow database, then introspectPostgres
   ▼                                             ▼
SchemaSnapshot + unsupported[]         what was captured, and what was reported but not captured
   │  canonicalizeSnapshot / serializeSnapshot / snapshotChecksum
   ▼
canonical JSON (format v1) + sha256    stored as an artifact; recorded as schema version N
   │  planMigration(from, to, {answers})  pure; matches objects by name, asks about renames and backfills
   ▼
MigrationPlan                          ordered operations with risk and warnings, unsupported changes, questions
   │  renderPostgresMigration(plan)    produces text; executes nothing
   ▼
SQL statements + review script
   │  verifyMigration                  runs in a throwaway shadow database, never a user database
   ▼
migration revision                     plan + script artifacts, verification result; reviewed by a second person
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
- **Apply (Phase 1b):** run an approved revision against a non-production environment, with locks, checks before and after, and per-environment history. Production protection comes after that.
- **More schema-tool adapters:** SQL DDL, multi-file Prisma schemas, importing `prisma/migrations` history.
- **Docker Compose** packaging.

## Tooling

- **TypeScript:**
  - Node 24 runs TypeScript directly through type stripping, so the packages have no build step. `tsc` only type-checks.
  - The web app is compiled by Next.js, which transpiles the workspace packages.
  - `pnpm typecheck` runs the root `tsc`, then `next typegen && tsc` for the app.
- **The local database:** `pnpm db:start` (`scripts/local-postgres.sh`) runs a disposable local PostgreSQL in `.local/`.
  - It holds the `skematron` database (metadata) and `skematron_test` (tests and the `demo` schema).
  - It creates the `skematron_shadow` role (CREATEDB, not a superuser) for shadow databases.
  - It adds any missing `.env` keys.
  - `pnpm db:seed [v1|v2]` loads the demo schema.
  - `pnpm db:migrate`, `db:deploy` and `db:generate` wrap Prisma.
- **Tests:** `node:test`, including metadata and migration integration tests, each in a throwaway `skematron_it_*` database (`lib/test-support.ts`).
- **Example:** `packages/adapters/examples/export-schema.ts` (`pnpm example:export`) uses the libraries without the dashboard.
- **Docs tooling:**
  - `scripts/sync-ai.ts` copies `ai/skills` into `.claude/skills` and `.codex/skills`.
  - `scripts/check-docs.ts` is the documentation gate that `pnpm check` runs.
