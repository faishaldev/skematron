# Gotchas

Things that surprised someone or cost time, and what to do about them. Add new ones as you find them.

## PostgreSQL catalog

- **`search_path` changes catalog output.** `format_type`, `pg_get_expr` and `pg_get_indexdef` leave names unqualified when they are visible in `search_path`. Introspection sets `search_path = ''` so every user object is schema-qualified, the same way in every session.
- **Other settings change how constants print.** `DateStyle`, `TimeZone`, `IntervalStyle`, `extra_float_digits`, `bytea_output`, `standard_conforming_strings` and `quote_all_identifiers` all affect default and check expressions. They are pinned in `sessionSettingsQuery`, transaction-local.
- **`pg_constraint.conindid` is also set for foreign keys.** For an FK it points at the referenced table's unique index. When excluding constraint-backed indexes, filter on `contype IN ('p', 'u', 'x')`, or unique indexes that FKs depend on disappear.
- **PostgreSQL 18 stores NOT NULL as constraints** (`contype = 'n'`). Skematron ignores those rows and uses `attnotnull`.
- **Identity columns own an internal sequence** (`pg_depend.deptype = 'i'`). It is omitted, because `identity` implies it. Serial columns own theirs with `deptype = 'a'`, and those are captured.
- **Check expressions from `pg_get_expr(conbin)` are already parenthesized.** The renderer wraps them in `CHECK (...)`, giving `CHECK ((a > 0))`, which round-trips to the same text.
- **`ALTER TYPE ... ADD VALUE`.** The new value cannot be used in the same transaction that adds it. Sending a multi-statement string as one simple query also runs it as one implicit transaction. The integration tests therefore apply statements one at a time.

## Drivers and tooling

- **node-postgres type parsing.** It returns `int8` as a string and parses `json` and arrays itself. Queries cast to text, int4 or bool, and return lists as JSON text, so the mapping does not depend on the driver.
- **Node type stripping.**
  - Relative imports need the `.ts` extension.
  - Only erasable syntax is allowed.
  - Use `import type` for types.
  - Node refuses to strip types under `node_modules`. Workspace packages work because they resolve to their real paths.
- **Where packages resolve from.** `pg` is a dependency of `packages/adapters` only. One-off scripts that import it must run from that directory.
- **The local Homebrew PostgreSQL requires a password, even over the Unix socket.** Do not weaken its auth. Use `pnpm db:test:start`.
- **When `.env` exists, `pnpm check` needs the test cluster running.** The integration tests fail, rather than skip, when a configured database is unreachable. Run `pnpm db:test:start` first, for example after a reboot.
- **initdb with macOS's bare `UTF-8` locale** warns that it found no text search configuration. The test cluster uses `--locale=C`.
- **Unix socket paths are limited to about 103 bytes on macOS.** Keep the test cluster directory short. The current path is about 77 bytes.
- **Prettier skips Markdown on purpose** (`.prettierignore`), so hand-written docs keep their formatting.
- **`npm install` breaks the pnpm layout.** It writes `package-lock.json` and copies packages into the root `node_modules`. To fix it, delete `package-lock.json` and every `node_modules`, then run `pnpm install --frozen-lockfile`.
- **No inline `# comments` in copy-paste command blocks.** Interactive zsh does not treat `#` as a comment unless `setopt interactivecomments` is on, so `pnpm example:export demo  # read it` passes `#`, `read`, `it` as arguments. Explain commands in prose and keep the blocks to commands only.
- **Do not hand people multi-line `node -e '…'` snippets.** Pasting them into zsh fails in confusing ways: a partial paste runs JavaScript as shell (`parse error near '}'`), and a `cd` at the top runs from the wrong directory. Give them a script and a `pnpm` command instead, like `pnpm example:export`.

## Next.js (apps/web)

- **`next dev` writes `apps/web/AGENTS.md`** (Next 16.4 "agent rules"). It tells agents to read the version-matched docs in `apps/web/node_modules/next/dist/docs/` first. Commit the file; deleting it only brings it back.
- **Next rewrites `apps/web/tsconfig.json`** on `next dev`, `next build` and `next typegen`. It adds `allowJs` and the mandatory `esModuleInterop`. Keep those settings, or every run produces a diff.
- **`next-env.d.ts` and the route types are generated** and git-ignored. `pnpm typecheck` runs `next typegen` before `tsc` so a fresh clone type-checks.
- **The repository `.env` is not in the app directory.** Next only loads `.env` from `apps/web`, so `next.config.ts` calls `process.loadEnvFile` on the root `.env`. Variables already set, such as `DATABASE_URL`, win.
- **Server actions reject a mismatched `Origin`** with a 500 and "Invalid Server Actions request". To post a form with curl, send `Origin: http://127.0.0.1:3100` and the hidden `$ACTION_ID_…` field taken from the page.
- **Page HTML contains every string twice**: once in the markup and once in the embedded React Server Components payload. Halve counts when grepping HTML in tests.

## Safety

- **Rendered SQL contains raw fragments** from the snapshot: types, defaults, expressions, index definitions. Review it before executing. Never execute a plan built from a snapshot you did not produce or review.
- **Text in SQL comments** must go through `commentText`. A newline in an object name would otherwise end the `--` comment and turn the rest into SQL.
