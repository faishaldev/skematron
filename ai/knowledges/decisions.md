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
