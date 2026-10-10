# Skematron

A self-hostable control plane for database schemas and migrations. It imports, versions, compares, reviews, exports and explicitly applies schema changes to databases you own. Skematron manages schema definitions and migration artifacts, never your application data.

**Status: pre-alpha.** Only the first library slice exists:

- **`@skematron/core`**
  - The schema snapshot model.
  - Canonical JSON with SHA-256 checksums.
  - A migration planner that orders operations and rates each one `safe`, `caution` or `destructive`.
- **`@skematron/adapters`**
  - Read-only PostgreSQL 14+ introspection that reports everything it does not capture.
  - SQL rendering of plans into a reviewable script.

There is no CLI, web app or apply step yet, and nothing in this repository writes to your databases. See `AGENTS.md` for the planned product.

## Development

Requires Node 24 (`nvm use`) and pnpm 10. Always use `pnpm`, never `npm install`: npm creates a stray `package-lock.json` and mixes up `node_modules`. Run commands from the repository root.

Install dependencies, then run the type check, format check, tests and documentation gate:

```sh
pnpm install
pnpm check
```

### See it work

1. Start the throwaway test database.
2. Load a sample `demo` schema into it.
3. Read the schema and print the SQL that recreates it.

```sh
pnpm db:test:start
pnpm db:test:seed
pnpm example:export demo
```

The output is SQL with comments: the snapshot checksum, the objects that were not captured, and the statements that recreate the schema, each marked safe, caution or destructive. To save it, run `pnpm -s example:export demo > demo.sql`.

To read your own database instead, run `DATABASE_URL='postgresql://user:password@localhost:5432/mydb' pnpm example:export public`. It only reads, inside a transaction that is always rolled back, and never prints the URL.

The PostgreSQL integration tests run only when `SKEMATRON_TEST_DATABASE_URL` is set. The easiest way is a disposable local cluster. It needs PostgreSQL 14+ server binaries, for example `brew install postgresql@14`. It has its own data directory under `.local/`, with no TCP and an owner-only socket.

`pnpm db:test:start` initializes the cluster on its first run, creates `skematron_test` and writes `.env`:

```sh
pnpm db:test:start
pnpm test
pnpm db:test:stop
```

Alternatively, set `SKEMATRON_TEST_DATABASE_URL` in `.env` to any dedicated, disposable PostgreSQL 14+ database (see `.env.example`). Tests only create and drop their own `skematron_test_*` schemas.

Once `.env` exists, `pnpm test` and `pnpm check` run the integration tests, so start the cluster first, for example after a reboot. A configured but unreachable database makes the tests fail rather than skip. Remove `.env` to skip them again.

## Documentation

- `AGENTS.md`: product rules and the entry point for AI agents.
- `ai/rules/`: rules per area.
- `ai/skills/`: step-by-step workflows, copied to `.claude/skills` and `.codex/skills` by `pnpm sync:ai`.
- `ai/knowledges/`: architecture, snapshot format, PostgreSQL support, decisions, gotchas, business model.
- `CHANGELOG.md`: every change, as required by `pnpm check`.

## License

All rights reserved. The license has not been chosen yet; see `ai/knowledges/business-model.md`.
