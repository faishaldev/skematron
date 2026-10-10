# Skematron

A self-hostable control plane for database schemas and migrations. It imports, versions, compares, reviews, exports and explicitly applies schema changes to databases you own. Skematron manages schema definitions and migration artifacts, never your application data.

**Status: pre-alpha.** What exists:

- **Dashboard (`apps/web`).** Single-organization, self-hosted:
  - Invitation-only accounts with roles.
  - Projects, and database environments with encrypted credentials.
  - Immutable schema versions imported read-only.
  - Version compare, drift checks, SQL/JSON export, and an audit log.
- **`@skematron/core`**
  - The schema snapshot model.
  - Canonical JSON with SHA-256 checksums.
  - A migration planner that rates each operation `safe`, `caution` or `destructive`.
- **`@skematron/adapters`**
  - Read-only PostgreSQL 14+ introspection that reports everything it does not capture.
  - SQL rendering of plans for review.
- **`@skematron/storage`:** checksum-verified artifact files.

There is no CLI or apply step yet, and nothing in this repository writes to your application databases. See `AGENTS.md` for the planned product, and `docs/self-hosting.md` to run it.

## Development

Requires Node 24 (`nvm use`) and pnpm 10. Always use `pnpm`, never `npm install`: npm creates a stray `package-lock.json` and mixes up `node_modules`. Run commands from the repository root.

Install dependencies, then run the type check, format check, tests and documentation gate:

```sh
pnpm install
pnpm check
```

### Run the dashboard locally

The local databases need PostgreSQL 14+ server binaries, for example `brew install postgresql@14`.

Start the disposable local PostgreSQL, apply the metadata migrations, load a sample schema, and start the dashboard:

```sh
pnpm db:start
pnpm db:migrate
pnpm db:seed
pnpm web
```

- **Local PostgreSQL:**
  - It has its own data directory under `.local/`, with no TCP and an owner-only socket.
  - On first run it creates `.env` with generated secrets.
- **Setup:** open <http://127.0.0.1:3100>. The first visit goes to setup, where you create your organization and owner account.
- **To try the workflow:**
  1. Create a project.
  2. Add an environment named `local`. Its connection URL is the `SKEMATRON_TEST_DATABASE_URL` value from `.env`, and its schema is `demo`.
  3. Click **Test connection**, then **Import version**.
  4. Load the changed sample schema, then import again:

     ```sh
     pnpm db:seed v2
     ```

  5. On the project page, compare v1 with v2. You get the migration between them, with each statement marked safe, caution or destructive.

Invite more people from **Members**. There is no email: copy the invitation link and send it yourself.

### Use the libraries without the dashboard

`pnpm example:export demo` reads the sample schema and prints the SQL that recreates it. To save it, run `pnpm -s example:export demo > demo.sql`.

To read your own database instead, run `DATABASE_URL='postgresql://user:password@localhost:5432/mydb' pnpm example:export public`. It only reads, inside a transaction that is always rolled back, and never prints the URL.

### Tests

The PostgreSQL integration tests run only when `SKEMATRON_TEST_DATABASE_URL` is set, and `pnpm db:start` sets it. Once `.env` exists, `pnpm test` and `pnpm check` run them, so start the local PostgreSQL first (for example after a reboot); an unreachable configured database makes the tests fail rather than skip. Tests only create and drop their own `skematron_test_*` schemas and `skematron_it_*` databases.

## Documentation

- `AGENTS.md`: product rules and the entry point for AI agents.
- `docs/self-hosting.md`: configuration, backups and upgrades.
- `ai/rules/`: rules per area.
- `ai/skills/`: step-by-step workflows, copied to `.claude/skills` and `.codex/skills` by `pnpm sync:ai`.
- `ai/knowledges/`: architecture, snapshot format, PostgreSQL support, decisions, gotchas, business model.
- `CHANGELOG.md`: every change, as required by `pnpm check`.

## License

All rights reserved. The license has not been chosen yet; see `ai/knowledges/business-model.md`.
