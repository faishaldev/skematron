# Decisions

An append-only log of design decisions.

- Add a new entry for every choice made between real alternatives.
- Never edit an old entry's decision. If it changes, add a new entry and mark the old one "superseded by Dn".

## D1: No build step: native TypeScript on Node 24, with node:test (2026-10-10, accepted)

- **Context.** A solo developer, and AGENTS.md says to prefer platform APIs and minimal dependencies. Node 24 runs TypeScript through type stripping.
- **Decision.**
  - Packages export `src/index.ts`, and Node runs `.ts` files directly.
  - `tsc` only type-checks (`noEmit`).
  - Tests use `node:test` and `node:assert/strict`.
- **Consequences.**
  - Code must use erasable syntax only: no enums, namespaces or parameter properties; `erasableSyntaxOnly` enforces this.
  - Relative imports include the `.ts` extension, and type-only imports use `import type`.
  - Publishing a package or the CLI will need a build or bundle step later.

## D2: Few dependencies, and adapters receive a session (2026-10-10, accepted)

- **Decision.**
  - Dev dependencies only: `typescript`, `@types/node`, `prettier`, plus `pg`/`@types/pg` for adapter integration tests.
  - The PostgreSQL adapter takes a caller-owned `PostgresSession` (`query(text)`) instead of connecting by itself.
- **Consequences.**
  - The adapter has no runtime dependencies.
  - Connection policy (credentials, TLS, SSRF) stays with the future app layer.
  - Any driver with a compatible `query` can be used.

## D3: Snapshot format v1, canonical JSON and SHA-256 (2026-10-10, accepted)

- **Decision.**
  - Snapshots are serialized as canonical JSON: sorted keys, 2-space indentation, trailing newline.
  - Their checksum is `sha256:<hex>` over those bytes, computed with Web Crypto.
  - Engine SQL fragments are stored verbatim.
- **Consequences.**
  - The serialization is readable in diffs.
  - The stored bytes are the identity of the schema version.
  - The format is frozen per version (see `snapshot-format.md`).

## D4: Equivalence means an empty plan, and column position is ignored (2026-10-10, accepted)

- **Context.** PostgreSQL cannot reorder columns. Appending a column, as migrations do, would otherwise leave a permanent difference against the intended schema.
- **Decision.**
  - Snapshots record column order.
  - The planner ignores it.
  - "Equivalent" means `planMigration` returns an empty plan.
- **Consequences.** Checksums identify exact snapshots, but verifying a migration must test equivalence.

## D5: PostgreSQL 14 or newer, read-only catalog introspection with pinned settings (2026-10-10, accepted)

- **Decision.**
  - Introspection requires server version 14 or newer.
  - It runs in a REPEATABLE READ READ ONLY transaction that is always rolled back, and reads only `pg_catalog`.
  - It pins `search_path` and the output settings, so catalog text is deterministic.
  - Everything it does not capture is reported.
- **Consequences.**
  - Snapshots of the same schema are identical across sessions.
  - Older servers get a clear error.

## D6: Planner matches objects by name and does not detect renames (2026-10-10, accepted)

- **Decision.** A rename is a drop plus a create, and the risk levels make the data loss visible.
- **Consequences.** Renames need manual review until an explicit rename feature exists.

## D7: AI docs live in an `ai/` hub, with a docs gate (2026-10-10, accepted)

- **Decision.**
  - `ai/rules`, `ai/skills` and `ai/knowledges` are the single source for AI-facing docs.
  - `pnpm sync:ai` copies skills to `.claude/skills` and `.codex/skills`, matching the convention of the owner's other repositories.
  - `pnpm check` runs a documentation gate: a CHANGELOG entry is required for changes to source and config, and the skill copies must match.
  - Root AGENTS.md is the auto-loaded entry point. It says which rule file applies to which area.
- **Consequences.**
  - Rules are not loaded per directory automatically; AGENTS.md directs agents to them.
  - Skill copies are committed, so tools work without running a script.

## D8: License pending (2026-10-10, accepted)

- **Decision.** Use `"license": "UNLICENSED"` (all rights reserved) and no LICENSE file until a license is chosen. The options are in `business-model.md`.
- **Consequences.** The license must be chosen before the repository is published or accepts outside contributions.

## D9: Edition and entitlement logic stays out of core and adapters (2026-10-10, accepted)

- **Decision.** Edition, entitlement, license-key and billing checks belong only in the app layer, so one codebase can serve both SaaS and self-hosted.
- **Consequences.** Core and adapters behave the same in every edition. Paid features gate access at the app layer.

## D10: A disposable local PostgreSQL for integration tests (2026-10-10, accepted)

- **Context.**
  - The development machine (macOS 12) has no Docker.
  - Its Homebrew PostgreSQL requires a password, even over the Unix socket.
  - Tests must never run against a shared or production database.
- **Decision.** `scripts/test-postgres.sh` (`pnpm db:test:start` / `db:test:stop`) creates its own cluster in `.local/postgres`:
  - `initdb` with the C locale
  - trust authentication for the current OS user only
  - Unix socket only, mode 0700, port 54329, no TCP
  - it writes `.env` if the file is missing
- **Consequences.**
  - No credentials are handled and the existing server is untouched.
  - Docker Compose (AGENTS.md) remains the plan for the app and self-hosting, and can replace this script later.

## D11: A local, read-only schema viewer as the first web app (2026-10-10, superseded by D12)

- **Context.** The owner wanted to try Skematron in a browser. The product dashboard needs authentication, organizations, a metadata database and storage, which is too much for a first step. AGENTS.md says not to build enterprise features before the core workflow works.
- **Decision.**
  - `apps/web` runs on Next.js 16 (App Router, Turbopack) with React 19.
  - It is local only: it binds to `127.0.0.1`, has no login, and is read-only toward databases. The connection URL comes from server-side environment only.
  - Pages: browse, export SQL, save snapshots, and compare live against a saved snapshot.
  - Snapshots are immutable files in `.local/snapshots`, each with a canonical `<id>.json` and a `<id>.meta.json`, verified by checksum when loaded. There is no metadata database yet.
  - `.ts` import extensions and erasable syntax stay the rule in the app.
- **Consequences.**
  - The viewer must never be deployed or exposed. The real dashboard needs authentication and per-project authorization first (AGENTS.md "Security").
  - The snapshot store is the local precursor of `packages/storage`; extract it when the CLI or the dashboard needs it.

## D12: The dashboard runs Better Auth in single-organization mode (2026-10-10, accepted)

- **Context.** The local viewer (D11) proved the workflow in a browser. A dashboard that teams use needs real authentication, roles and invitations. It must also work self-hosted, without depending on the hosted service.
- **Decision.**
  - Better Auth 1.7.7: email and password, plus the organization plugin, with sessions in the metadata database through its Prisma adapter.
  - Single-organization mode: `/setup` creates the one organization and its owner, then sign-up is invitation-only. The `maySignUp` hook in `user.create.before` enforces this.
  - Roles are viewer, member, admin and owner. App permissions come from `lib/roles.ts`; Better Auth access control covers organization management only.
  - The owner role cannot delete the organization, and users cannot create organizations.
  - Invitations are links, with no email. Telemetry is off.
  - The local viewer is removed; its features moved under projects.
- **Consequences.**
  - The dashboard can be self-hosted for one team. Hosted multi-tenant mode reuses the same tables, but needs an SSRF guard, quotas and entitlements first.
  - Accepting an invitation is done by the app itself (`acceptInvitation`), so membership and the audit log stay consistent.

## D13: Prisma 7.10.0 for the metadata database, pinned (2026-10-10, accepted)

- **Context.** AGENTS.md lists Prisma for the metadata database. On 2026-10-10, npm's `latest` tag for `prisma` pointed at 8.0.0-rc.22, while Better Auth supports Prisma 5–7.
- **Decision.**
  - Pin `prisma`, `@prisma/client` and `@prisma/adapter-pg` to 7.10.0.
  - Use the `prisma-client` generator (ESM, `importFileExtension = "ts"`, output `apps/web/generated/prisma`, git-ignored, generated on install) with the `@prisma/adapter-pg` driver.
  - The schema and migrations are in root `prisma/`; `prisma.config.ts` reads `SKEMATRON_DATABASE_URL`.
- **Consequences.**
  - The generated client works under Node's native TypeScript, so `node:test` integration tests can use it.
  - Upgrade to Prisma 8 only together with a Better Auth release that supports it.

## D14: Stored connection URLs are encrypted with AES-256-GCM (2026-10-10, accepted)

- **Decision.**
  - `lib/secrets.ts` encrypts with `SKEMATRON_SECRET_KEY` (32 bytes, base64) and a random IV, producing the format `v1.<iv>.<ciphertext>.<tag>`.
  - Only a redacted `connectionHint` is stored in plaintext.
  - Only `lib/targets.ts` decrypts.
  - URLs are validated against an allow-list of parameters, which rules out file-reading SSL options.
- **Consequences.**
  - Losing the key means stored connections must be re-entered, so back it up together with the database.
  - The `v1` prefix leaves room for key rotation.

## D15: Content-addressed artifact store (`@skematron/storage`) (2026-10-10, accepted)

- **Decision.**
  - Artifacts are files named by their SHA-256 under `SKEMATRON_ARTIFACT_DIR` (default `.local/artifacts` in development; required in production).
  - Writes are atomic (a temporary file, then `link`) and never overwrite.
  - Reads are verified against the key.
  - A schema version's checksum is its artifact key.
- **Consequences.**
  - Identical snapshots are stored once.
  - An artifact left by a failed version insert is harmless, and can be garbage-collected later.
  - Quotas, and other storage backends behind the same interface, are future work.

## D16: One local PostgreSQL cluster for development and tests (2026-10-10, accepted; extends D10)

- **Decision.**
  - `scripts/test-postgres.sh` becomes `scripts/local-postgres.sh`, with commands `pnpm db:start`, `db:seed` and `db:stop`. The `db:test:*` aliases are kept.
  - It also creates the `skematron` metadata database, and adds missing `.env` keys with generated secrets: `SKEMATRON_DATABASE_URL`, `SKEMATRON_SECRET_KEY`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.
  - It never overwrites existing keys.
- **Consequences.** A fresh clone runs the dashboard with `pnpm install`, `pnpm db:start`, `pnpm db:migrate` and `pnpm web`.

## D17: A shadow database server for SQL derived from user input (2026-10-10, accepted)

- **Context.** Prisma schema import and migration verification have to run SQL that comes from users (Prisma's DDL with `dbgenerated` expressions, plans built from imported snapshots) to see what it really does. Running it against an environment would change a user's database; parsing it ourselves would be guesswork.
- **Decision.**
  - `SKEMATRON_SHADOW_DATABASE_URL` points at the maintenance database of a dedicated, disposable PostgreSQL 14+ server, with a role that has CREATEDB and is not a superuser. `lib/shadow.ts` refuses a superuser role.
  - Every run creates `skematron_shadow_<random>`, connects with statement and lock timeouts, and drops it with `WITH (FORCE)` afterwards, also on failure. The drop is guarded by the prefix.
  - Without the variable, Prisma import fails with a clear message and verification is recorded as `unavailable`, which blocks submission.
  - Locally, `pnpm db:start` creates the `skematron_shadow` role in the development cluster.
- **Consequences.**
  - Verification proves a plan against an empty copy of `from`. It does not prove the plan against real data: rows that violate a new constraint, and views or triggers Skematron does not capture, can still fail in a real database.
  - A process killed mid-run can leave a `skematron_shadow_*` database behind; it can be dropped by hand.
  - Anyone who may import a `schema.prisma` (member and up) can effectively run SQL there: Prisma inserts `dbgenerated(...)` expressions into its DDL verbatim. The non-superuser role, the per-run database and the timeouts bound the damage. That is acceptable for one self-hosted team, but hosted multi-tenant mode needs stronger isolation, such as a shadow server per tenant or a sandbox.

## D18: `schema.prisma` becomes a version through Prisma's own CLI (2026-10-10, accepted)

- **Context.** Teams using Prisma keep their schema in `schema.prisma`. Writing our own Prisma parser would drift from Prisma's behavior (defaults, native types, relation constraints, index names).
- **Decision.**
  - `@skematron/adapters` gets a schema-tool adapter, `prisma/schema-file.ts`. `preparePrismaSchema` finds the top-level blocks, requires exactly one `postgresql` datasource, and blanks the `url`, `directUrl` and `shadowDatabaseUrl` lines. Line numbers stay the same, so Prisma's error messages match the uploaded file. Generators are kept, because they carry preview features that the schema may need (`extensions`, `views`), and `migrate diff` never runs them.
  - The web app runs the Prisma CLI that it depends on (`prisma@7.10.0`): `migrate diff --from-empty --to-schema schema.prisma --script`, in a temporary directory, with a 60-second timeout and an environment that holds none of Skematron's secrets. Prisma 7 needs a config file with a datasource URL even for this offline command; Skematron writes one that points at port 1 on loopback.
  - The DDL runs in a shadow database, and introspecting that database gives the snapshot. The prepared schema file is stored as an artifact, and the version's source records `prisma-schema`, the Prisma version and the file's checksum.
- **Consequences.** Prisma 5, 6 and 7 schemas work. Multi-file schemas, `prisma/migrations` history and `_prisma_migrations` are not read yet.

## D19: Guided plans: questions with stable ids instead of guessed renames (2026-10-10, accepted)

- **Context.** Matching by name turns every rename into a drop plus a create, which loses data. Adding a NOT NULL column without a default fails on tables with rows. Users should not have to write SQL to fix either.
- **Decision.**
  - `planMigration(from, to, { answers })` returns `questions` (in `packages/core/src/questions.ts`): `rename-table`, `rename-column` and `rename-sequence` with their candidates, and `backfill`. A question's id is a JSON array, for example `["rename-column","public","User","fullName"]`.
  - Candidates are added objects of the same shape: a table with the same column names and types, a column with the same type, collation and generation, a sequence with the same settings.
  - Questions come in stages (tables, columns, sequences, backfills); answers to earlier stages decide which later questions exist.
  - A rename answer is applied to a copy of `from`, including key column lists, foreign key references and sequence owners. The plan then starts with `rename-*` operations and diffs as usual. SQL fragments that name the old object (index definitions, check expressions) are recreated; the shadow check confirms the end state.
  - A backfill answer adds the column with `DEFAULT '<value>'::<type>` and drops the default afterwards.
  - Unknown or invalid answers throw `PlanningError`, unless `ignoreUnusedAnswers` is set, which the dashboard uses while answers are being edited.
- **Consequences.** The core rule "do not guess renames" still holds: Skematron proposes, a person decides. A table renamed together with column changes is not detected; it stays a drop plus a create.

## D20: Migrations are immutable revisions with four-eyes review (2026-10-10, accepted)

- **Context.** The goal is for every developer to create and review migrations in the dashboard instead of locally. An approval must mean that a second person saw exactly what will run.
- **Decision.**
  - `migration` holds the number, title, from and to versions, and status. `migration_revision` rows are never updated: each holds the answers, the plan and script as artifacts, the risk summary and the shadow verification result. `migration_review` rows record verdicts on one exact revision.
  - Status: draft → in_review → approved or rejected. Any new revision returns the migration to draft, so an approval never carries over to different content.
  - Submitting needs no open questions, no unsupported changes and a passed verification.
  - Reviewing needs the `review-migrations` permission (admin and owner). The reviewer must not have written the migration or the revision. Approving destructive operations needs an explicit acknowledgment, and rejecting needs a comment. The reviewer approves the revision they looked at; if it changed in between, the review is refused.
  - Status changes and revision numbers take a per-migration advisory lock.
- **Consequences.** Phase 1b can apply an approved revision by its stored script checksum. Production-specific approval rules (more reviewers, environment promotion) come later.

## D21: Schemas written in the dashboard: a per-project source, private drafts, normalized by PostgreSQL (2026-10-10, accepted)

- **Context.** Teams without an ORM, or teams that design the database first, want to add tables and columns in Skematron itself. For teams whose schema lives in code (a `schema.prisma`), editing in the dashboard would create a second source of truth: the application's schema file would not know about the change.
- **Decision.**
  - Each project has a schema source, "code" or "dashboard", chosen at creation. Admins can change it (audited as `project.update`).
    - The editor works only for "dashboard" projects.
    - Prisma import works only for "code" projects.
    - Environment imports work for both.
  - Edits go into a private, mutable draft per person and project (`schema_draft`), started from the latest version.
    - Core's edit functions (`addTable`, `addColumn`, `addUniqueConstraint`, `addIndex`, `addForeignKey`) apply each edit.
    - The whole draft is then rebuilt in a shadow database and introspected. The stored draft is therefore always what PostgreSQL really creates: `int` becomes `integer`, and index definitions are in `pg_get_indexdef` form. An invalid edit is rejected with PostgreSQL's own message.
  - Typed types must look like a type, and defaults may not contain `;` or comments (`lib/schema-input.ts`). Everything still runs only in the shadow database.
  - Saving goes through `recordVersion` with `basedOn`. Under the per-project lock, it is refused when another version was saved since the draft started, so a stale draft never drops newer changes. There is no rebase yet: discard and start again.
- **Consequences.**
  - Versions from the editor are interchangeable with imported ones, so drift checks and migrations work on them unchanged. A NOT NULL column added to an existing table leads to a backfill question in the migration.
  - The editor needs the shadow database.
  - Not yet supported in the editor: dropping or renaming objects, enums, check constraints, comments, and exporting a `schema.prisma` for dashboard projects.

## D22: Changes go through branches; main grows only by merging (2026-10-11, accepted; supersedes D21's drafts and D20's version-to-version migrations)

- **Context.** With D20 and D21, saving the editor's draft or importing a schema immediately added the next version, and migrations were created between any two versions. Teams expect what git gives them instead: work on a change separately, get it reviewed, and only then make it part of the agreed schema. An abandoned change should leave no trace on the main line.
- **Decision.**
  - **Main** is the line of immutable versions. Its first version (the baseline) comes from a `schema.prisma` import or the first environment import. After that, main only grows by merging a branch.
  - **A branch** (`branch` table) has a base (the latest version on main when it started) and a head (a snapshot that changes).
    - It is shared: the team sees it and members can change it.
    - Its head comes from the schema editor ("dashboard" projects) or from `schema.prisma` uploads ("code" projects). Environment imports that differ from main become a new branch, `from-<environment>`.
    - Every head change is checked against `updatedAt`, so concurrent edits never overwrite each other. It also sends the review back to draft.
  - **A migration** is now the review of one branch. Each test run is an immutable revision that records the head it planned towards (`toChecksum`). A test run counts only if it was made after the branch's last change.
  - **Four-eyes rule:** the reviewer must not have worked on the branch at all. That means not its creator and not anyone in `contributorIds`, the list of people who changed, rebased or tested it.
  - **Merge:**
    - Allowed after approval. It needs an approval of the current test run for exactly the current head, and main still at the branch's base.
    - It records the version and the branch's merged status in one transaction (`recordVersion` with `basedOn` and `onCreated`).
  - **Main moved on:** if main changed while the branch was open, the branch is rebased onto the latest version. The head stays, so anything that would undo newer work on main appears in the change list and must be reviewed. There is no automatic three-way merge.
  - **Close** ends a branch without recording anything on main.
  - The existing drafts were converted into open branches by the metadata migration, so no work was lost. Free-standing migrations between two versions are no longer created.
- **Consequences.**
  - Main can mean "approved", not yet "applied". When apply exists (Phase 1b), approved versions are rolled out to environments.
  - Rebasing a branch whose head does not contain main's newer changes shows them as reversals. Dashboard branches have to redo those changes. Code branches upload a schema.prisma that includes them.
