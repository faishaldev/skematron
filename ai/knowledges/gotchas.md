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

## Safety

- **Rendered SQL contains raw fragments** from the snapshot: types, defaults, expressions, index definitions. Review it before executing. Never execute a plan built from a snapshot you did not produce or review.
- **Text in SQL comments** must go through `commentText`. A newline in an object name would otherwise end the `--` comment and turn the rest into SQL.
