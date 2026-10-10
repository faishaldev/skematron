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
