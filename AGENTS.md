# AGENTS.md — Skematron

## Product Overview

Skematron is a web-based, self-hostable control plane for database schemas and migrations. It helps teams import, version, compare, review, export, and explicitly apply schema changes to databases they own.

**Skematron manages schema definitions and migration artifacts, not application data.** It must not act as a database hosting service, automatically copy production data, or store database dumps as part of the normal workflow.

The product must be generic and ORM-agnostic. Prisma is one supported schema-tool adapter, not a core dependency or the definition of the product.

## Product Principles

- Prefer a simple, maintainable implementation suitable for a solo developer and a limited budget.
- Start as a modular monolith. Do not introduce microservices or infrastructure without a demonstrated need.
- Self-hosted deployments must work independently of Skematron's hosted service.
- Keep schema definitions, published versions, and approved migration artifacts immutable and checksum-verifiable.
- Make destructive or production-impacting operations explicit, reviewable, auditable, and safe by default.
- Never silently change a user's application database.
- Do not add features, packages, or abstractions speculatively. Prefer the smallest design that preserves important boundaries.

## Initial Stack

- TypeScript and Node.js.
- Next.js and React for the web dashboard and server-side API.
- pnpm workspace monorepo. Add Turborepo only if task orchestration becomes useful.
- PostgreSQL for Skematron's own metadata.
- Prisma may be used to access Skematron's metadata database only; keep application-database and schema-tool support behind adapters.
- Node.js CLI for local developer workflows.
- Docker Compose for self-hosted deployment and local development.
- Local filesystem storage for the initial artifact store, behind a small storage interface so another provider can be added later.
- Avoid Redis/BullMQ, a dedicated worker service, object storage, Kubernetes, microservices, and a third-party billing integration in the initial MVP unless a concrete requirement justifies them.

## Suggested Repository Layout

Keep the repository small. A reasonable starting point is:

- `apps/web`: dashboard, API routes, and server-side orchestration.
- `apps/cli`: CLI commands for linking, syncing, status, import/export, and migration workflows.
- `packages/core`: framework-independent schema domain, normalization, versioning, diffing, and migration planning.
- `packages/adapters`: database and schema-tool adapter interfaces and implementations.
- `packages/storage`: artifact storage, checksums, metadata, and quota-aware writes.
- `packages/contracts`: shared request/response and CLI/API contracts, if needed.
- `prisma/`: migrations for Skematron's metadata database only.
- `infra/compose`: Docker Compose files and deployment configuration.
- `docs/`: user and developer documentation.
- `ai/`: AI-facing docs: `rules/`, `skills/` (the source for the `.claude/skills` and `.codex/skills` copies), and `knowledges/`.
- `scripts/`: repository tooling (AI-doc sync, documentation gate, local PostgreSQL).

Do not create every directory or package up front. Introduce boundaries as the code requires them.

## Architecture Boundaries

### Skematron metadata database

Stores platform metadata such as accounts, organizations, projects, schema-version records, adapter information, environment definitions, migration plans, execution records, audit events, trial/subscription state, and artifact metadata.

Its schema is changed only through versioned Skematron metadata migrations.

### User application databases

These are external targets managed by explicit user-authorized workflows. They are not Skematron's metadata database. Platform startup, deployment, or upgrade must never apply Skematron metadata migrations to user application databases.

Database access must be server-side, least-privilege, validated, and auditable. Do not expose connection credentials to the browser, CLI output, logs, telemetry, or error messages. Encrypt stored credentials at rest when credential persistence is necessary.

### Schema-tool adapters and database adapters

Keep these as separate concepts:

- **Schema-tool adapter:** imports, parses, validates, normalizes, diffs, or generates artifacts for a schema format/tool (for example, Prisma Schema).
- **Database adapter:** connects to a database engine, reads schema metadata, understands engine capabilities, and applies/verifies supported SQL operations (for example, PostgreSQL).

Core domain logic must not import Next.js, Prisma-specific schema code, concrete database drivers, queue implementations, or UI components.

## Schema and Migration Rules

- Importing a live database reads schema metadata; it must not dump or copy table contents.
- Importing an existing schema creates a baseline snapshot. Do not fabricate historical migrations that are not provided.
- If migration history is supplied, import and validate it separately; report gaps or inconsistencies clearly.
- Schema versions are immutable. Changes create a new version.
- Keep the intended schema version separate from observed database state.
- Store schema format, adapter name/version, checksum, provenance, and compatibility metadata with each artifact where applicable.
- Generate migration plans separately from executing them.
- Show the planned SQL and meaningful warnings before applying changes, especially for destructive or potentially data-loss operations.
- Require explicit authorization for applying migrations. Production execution should support approval and audit records.
- Before applying a migration, verify the target, expected source state, approved artifact checksum, and execution lock. Record status and errors.
- Verify the database after execution; do not assume a successful SQL response means the target reached the intended state.
- Do not promise that a rollback is always safe. Prefer forward fixes and expand-and-contract migrations for risky production changes.
- Do not use a schema-push command as the sole production migration mechanism.
- Never execute migrations against a database simply because a schema was synced or imported.

## Import, Export, and Local Development

Support formats through adapters. Initial candidates are PostgreSQL introspection, SQL DDL import/export, and Prisma Schema import/export where supported. Be explicit about unsupported database-specific objects and lossy format conversions.

The CLI should eventually support workflows such as:

- `skematron link`
- `skematron sync`
- `skematron status`
- `skematron status --check-db`
- `skematron migration plan`
- `skematron migration review`
- `skematron migration apply`
- `skematron migration history`

These are planned command names; do not claim they exist until implemented.

Sync downloads a pinned, immutable schema artifact and verifies its checksum. It must not automatically choose the latest schema unless the user explicitly requests that behavior. Sync does not execute migrations and does not copy production data.

Use a repository lock file such as `.skematron.lock` to pin schema version and relevant adapter/generator versions. Do not put secrets in this file.

Local database setup must explicitly target the local development database. Never infer that a database is local based only on its name. Display the target and require confirmation for potentially destructive actions. Prefer synthetic seed data or user-managed fixtures; production data is not part of normal schema sync.

Export should allow users to retrieve their schema and artifacts. Avoid vendor lock-in; document format limitations and ensure a project can be exported without requiring access to the hosted service.

## Security

- Treat database connection strings, tokens, private keys, and credentials as secrets.
- Prevent server-side request forgery (SSRF) when users supply database hosts. Block loopback, link-local, cloud metadata, and private/internal destinations by default in hosted SaaS unless an explicitly designed, authenticated private-network connection feature permits them.
- Validate connection targets and supported protocols before connecting.
- Use least-privilege database credentials and TLS where supported.
- Never log SQL parameter values or credentials by default.
- Avoid storing application rows, database dumps, or production backups as part of schema management.
- Audit privileged actions, migration approvals, and migration execution outcomes.
- Apply authorization checks on the server for every project and artifact operation.

## Storage and SaaS Trial

Keep usage metering and entitlements simple and server-enforced. Do not couple core schema logic to a billing provider.

Initial trial policy proposal (keep configurable; do not hard-code policy throughout the codebase):

- 14-day trial or 500 MB of persisted Skematron artifacts per organization, whichever limit is reached first.
- No credit card required for the trial unless product policy changes.
- The storage quota covers persisted schema snapshots, migration artifacts, stored exports, and other explicitly metered artifacts.
- It does not count the size of user application databases or their rows, Skematron's metadata database, or transient regenerable caches.
- Temporary uploads that are discarded after processing should not count as persistent storage.
- Provide warnings around 80% and 100% of quota.
- Enforce quota on the server, including concurrent writes; use reservation or atomic accounting to prevent quota races.
- When trial access expires or storage is full, preserve reasonable read/export access and prevent writes that exceed the applicable policy. Do not immediately delete customer artifacts.
- Define a clear retention/grace-period policy before deleting any data.
- Self-hosted installations should not enforce hosted SaaS trial limits by default. Self-hosted administrators control their own retention and storage policy.

Trial duration, quota, grace period, and entitlements must be configuration/policy values, not scattered constants.

## Deployment and Upgrades

- Self-host with Docker Compose; document persistent volumes, environment variables, backup, restore, and upgrade procedures.
- Back up Skematron's metadata database and artifact store consistently. A metadata backup without the referenced artifacts may be incomplete.
- Skematron upgrades may migrate only Skematron's own metadata database.
- Use backward-compatible/expand-and-contract metadata migrations when possible, particularly if web and worker processes can overlap during deployment.
- Document compatibility between Skematron version, metadata schema, CLI, adapters, and stored artifact formats.
- Do not assume changing an image tag back is a safe rollback after a metadata migration.
- Provide preflight checks, release notes, and a recovery plan for upgrades that may affect persisted metadata.
- Self-hosted users choose when to upgrade; the platform should not silently force an upgrade through a hosted dependency.

## Implementation Guidelines

- Follow existing repository conventions before introducing new ones.
- Prefer clear TypeScript types and small modules over generic frameworks or elaborate abstractions.
- Keep core domain logic deterministic and testable without a running Next.js server or real database.
- Validate all external input at system boundaries.
- Handle errors explicitly; do not swallow failures in migration or storage operations.
- Use transactions and uniqueness/locking constraints where needed for version publication, quota accounting, and migration execution.
- Add tests for domain logic, adapter contracts, quota boundaries, authorization, and migration safety.
- Test destructive and failure paths, including interrupted execution and retry behavior.
- Do not add dependencies without a clear benefit. Prefer platform APIs and existing dependencies where practical.
- Update docs and examples when changing CLI behavior, schema formats, migration semantics, configuration, or deployment requirements.
- Do not implement speculative enterprise features before the core import → version → diff → review → export/apply workflow works reliably.

## Current State

Pre-alpha. What exists:

- `packages/core` (`@skematron/core`): snapshot format v1, canonical JSON with SHA-256 checksums, schema editing functions (`addTable`, `addColumn`, …), and `planMigration` (ordered operations with risk levels, warnings and unsupported changes, plus questions about possible renames and backfills that answers resolve).
- `packages/adapters` (`@skematron/adapters`): read-only PostgreSQL 14+ introspection (`introspectPostgres`), SQL rendering (`renderPostgresMigration`), and the Prisma Schema adapter (`preparePrismaSchema`).
- `packages/storage` (`@skematron/storage`): content-addressed, checksum-verified artifact files.
- `apps/web` (`@skematron/web`): the **dashboard**, in single-organization mode. It runs on Next.js 16, Better Auth and Prisma 7, with a metadata database in `prisma/`.
  - First-run setup and invitation-only sign-up.
  - Roles: viewer, member, admin, owner.
  - Projects, and environments whose connection URLs are encrypted.
  - Versions are immutable and checksummed, imported read-only from an environment or from a `schema.prisma` (through the Prisma CLI and a shadow database).
  - Compare versions, check drift, export SQL or JSON.
  - Main and branches:
    - Main is the line of immutable versions. After the baseline (v1), it changes only by merging a branch.
    - A branch is a shared, proposed change. Its content comes from the schema editor ("dashboard" projects) or from `schema.prisma` uploads ("code" projects).
    - Each branch is planned with guided questions instead of SQL and test-run in a shadow database (`SKEMATRON_SHADOW_DATABASE_URL`).
    - It is reviewed four-eyes: an admin or owner who did not work on it approves. Then it is merged, or closed without a trace on main.
  - An audit log.

Not built yet: applying migrations to environments (Phase 1b) and production protection, hosted multi-tenant SaaS mode (SSRF guard, quotas, billing), the CLI and API tokens, SQL DDL import, multi-file Prisma schemas and Prisma migration history import, email delivery, and Docker Compose. The CLI command names above are still plans. See `ai/knowledges/architecture.md` and `docs/self-hosting.md`.

## Development

- Requirements: Node 24 (`.nvmrc`; run `nvm use`) and pnpm 10. Node runs TypeScript directly, with no build step.
- Code conventions:
  - Relative imports end in `.ts`.
  - Type-only imports use `import type`.
  - Only erasable TypeScript syntax is allowed (no enums, namespaces or parameter properties).
- Commands:
  - `pnpm install`
  - `pnpm check`: typecheck, Prettier check, all tests, and the documentation gate. It must pass before a change is done.
  - `pnpm test`, `pnpm typecheck`, `pnpm format`
  - `pnpm sync:ai`: copy `ai/skills` to the tool folders.
- Local databases:
  - `pnpm db:start` starts a disposable, socket-only local PostgreSQL in `.local/`. It holds `skematron` (the metadata database) and `skematron_test` (tests and the demo schema), and the `skematron_shadow` role for shadow databases (`SKEMATRON_SHADOW_DATABASE_URL`).
  - It adds any missing `.env` keys with generated secrets, and never overwrites existing ones.
  - `pnpm db:stop` stops it. The `db:test:*` names are aliases.
- Metadata database (Prisma, see `ai/rules/metadata.md`):
  - `pnpm db:migrate` creates and applies migrations in development; `pnpm db:deploy` applies them in production.
  - `pnpm db:generate` regenerates the client. Install runs it too; Prisma 7's `migrate dev` does not, so run it after `db:migrate`.
- PostgreSQL integration tests run only when `SKEMATRON_TEST_DATABASE_URL` is set (`.env`, git-ignored); the migration tests also need `SKEMATRON_SHADOW_DATABASE_URL`. Never point either at a shared or production server.
- Try it by hand:
  - `pnpm web` starts the dashboard at <http://127.0.0.1:3100>. The first visit goes to `/setup`.
  - `packages/adapters/src/prisma/fixtures/v1.prisma` and `v2.prisma` are sample Prisma schemas: import both, then create a migration between them.
  - `pnpm db:seed [v1|v2]` loads a sample `demo` schema into `skematron_test`. It writes to the local cluster only. Add it as an environment with that URL and schema `demo`; loading `v2` later gives Compare something to show.
  - `pnpm example:export [schema…]` runs `packages/adapters/examples/export-schema.ts`. It is read-only, and uses `DATABASE_URL` or else the test database.
- Configuration for self-hosting: `docs/self-hosting.md`.
- Use pnpm only. `npm install` creates `package-lock.json` and mixes up `node_modules`.

## AI Docs: Rules, Skills, Knowledges

All AI-facing documentation lives in `ai/`. Before changing code, read this file, then the rule file for the area you touch, then `ai/knowledges/README.md` for background. When a skill matches the task, follow it.

| Area you touch | Rule file |
| --- | --- |
| `packages/core/**` | `ai/rules/core.md` |
| `packages/adapters/**` | `ai/rules/adapters.md` |
| `apps/web/**` | `ai/rules/web.md` |
| `prisma/**`, `prisma.config.ts`, Prisma queries | `ai/rules/metadata.md` |
| Tests, fixtures, test databases | `ai/rules/testing.md` |
| Every change | `ai/rules/documentation.md` |

- **Skills:**
  - `ai/skills/documenting-changes`: run it at the end of every change.
  - `ai/skills/extending-postgres-support`: use it to capture new PostgreSQL objects or properties.
  - `ai/skills/walking-through-the-dashboard`: use it to click through a changed dashboard flow end to end without touching the dev data.

  Edit skills only in `ai/skills/`. `pnpm sync:ai` copies them to `.claude/skills` and `.codex/skills`; never edit those copies.
- **Knowledges** (`ai/knowledges/`): architecture, glossary, snapshot format, PostgreSQL support, business model (SaaS and self-hosted, license pending), decisions and gotchas.

## Every Change Is Documented

In the same change, and following `ai/rules/documentation.md`:

- Add a `CHANGELOG.md` entry under `[Unreleased]` for any change to source, scripts or configuration.
- Update the knowledges the change makes inaccurate.
- Record decisions in `ai/knowledges/decisions.md` and surprises in `ai/knowledges/gotchas.md`.
- Update rules and skills when conventions or workflows change.
- Turn a repeated multi-step workflow into a new skill.

`pnpm check` enforces the CHANGELOG entry and the skill copies.

## Definition of Done

A change is complete when:

1. It solves the stated task without expanding scope unnecessarily.
2. Types, validation, authorization, and error handling are appropriate.
3. Relevant tests pass, including failure cases for safety-sensitive code.
4. No user database is modified implicitly.
5. No secrets or application data are exposed in logs or artifacts.
6. Documentation/configuration examples are updated where needed.
7. Any remaining limitations or unsupported adapter behavior are stated clearly.
8. `pnpm check` passes, including the documentation gate, and the CHANGELOG, knowledges, rules and skills reflect the change.
