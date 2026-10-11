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
- **The local Homebrew PostgreSQL requires a password, even over the Unix socket.** Do not weaken its auth. Use `pnpm db:start`.
- **When `.env` exists, `pnpm check` needs the local cluster running.** The integration tests fail, rather than skip, when a configured database is unreachable. Run `pnpm db:start` first, for example after a reboot.
- **`process.loadEnvFile` never overrides variables that are already set.** That makes it safe to pass `SKEMATRON_DATABASE_URL` explicitly to Prisma, as the integration tests do.
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
- **`redirect()` throws, so catching it breaks it.** Server actions wrap their work in `runAction()`, which calls `unstable_rethrow` first in its `catch`. Without that, the redirects from `requireActor()` (to `/sign-in`) would be shown as errors.
- **React splits text around values.** `{n} operations` renders as `19<!-- --> operations`. Strip `<!-- -->` before matching page text.
- **A server component cannot import plain values from a `"use client"` module.** It gets a client reference instead of, say, a string, so `cookies().get(NAME)` silently found nothing. Put constants that both sides need in a separate module without the directive (`components/last-project.ts`).
- **`next build` can run next to a running `next dev`.** Next 16 keeps dev output in `.next/dev`. To click through a flow without touching the dev database, build, then run `next start --port 3101` with `SKEMATRON_DATABASE_URL`, `SKEMATRON_ARTIFACT_DIR` and `BETTER_AUTH_URL` pointing at scratch values. Already-set variables win over `.env`.
- **A form's submit button travels with the form.** React passes the clicked button's `name` and `value` to the server action, which is how the review form sends `verdict`. When posting with curl, set that field yourself.
- **Server actions accept bodies up to 1 MB by default** (`serverActions.bodySizeLimit`). The Prisma upload limit (512 KB) stays below it.

## Prisma and Better Auth

- **npm's `latest` tag for `prisma` was an 8.0 release candidate** (2026-10-10), and Better Auth supports Prisma up to 7, so the versions are pinned to 7.10.0. Check Better Auth's peer dependencies before upgrading.
- **pnpm 10 skips Prisma's install scripts** ("Ignored build scripts"). The CLI downloads the schema engine when it first needs it, so this is harmless.
- **Prisma's engine needs a host in the URL, even for a Unix socket.** Use `postgresql://user@localhost:54329/db?host=/socket/dir`. node-postgres also accepts `postgresql:///db?host=…&port=…`, but Prisma does not.
- **The Better Auth CLI (`auth generate`) loads `lib/auth.ts`.**
  - Export the `.env` variables first: `env $(grep -v '^#' .env | xargs) pnpm dlx auth@1.7.7 generate …`.
  - It rewrites the whole schema file and inserts blank lines after `///` comments, which detaches them; remove those lines.
  - `lib/auth.ts` must not import `server-only`, or the CLI cannot load it.
- **`Invitation.role` is optional** in the generated schema. Treat a missing role as `member`.
- **Better Auth's own HTTP endpoints exist alongside the dashboard** (`/api/auth/organization/*`).
  - They enforce Better Auth's permissions, but they skip the app's audit log.
  - The owner role leaves out organization delete, and users cannot create organizations, so the risky endpoints are closed.
  - Keep that in mind whenever you change roles.
- **A running `next dev` keeps its Prisma client across hot reloads** (on `globalThis`). After a metadata schema change, a client built from the old generated code has no delegates for the new models ("Cannot read properties of undefined (reading 'findMany')"). `lib/db.ts` now rebuilds the client when the generated `PrismaClient` class changes. `instanceof` cannot be used for that, because it is always false for Prisma 7 clients. New `.env` variables still need a restart of `pnpm web`.
- **`prisma migrate dev --create-only` refuses to run non-interactively when a change loses data** (for example a dropped table). Generate the SQL with `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` against the up-to-date development database, write it into a new `prisma/migrations/<timestamp>_<name>/migration.sql` (add any data copy before the drop), apply it with `pnpm db:deploy`, and check that the same diff is then empty.
- **PostgreSQL's JSONB reorders object keys** (shorter keys first). A snapshot read back from a JSON column (a branch head) has the same content as its artifact but a different `JSON.stringify` result. Compare snapshots with the planner, or with `serializeSnapshot`, which sorts keys.
- **Compare timestamps from one clock.** Whether a branch's test run is current is decided by comparing the revision's `createdAt` with the branch's `updatedAt`. Both are set by the app (`new Date()`), not one by the app and one by the database's `now()`.
- **`prisma migrate dev` does not regenerate the client in Prisma 7.** After `pnpm db:migrate`, run `pnpm db:generate`, or the new models are missing from the types.
- **Prisma 7's `migrate diff` needs a config with a datasource URL, even offline.** Without one, it fails with an empty "Error in Schema engine:"; the debug log (`DEBUG="prisma*"`) shows the engine's missing `--datasource` argument. `--from-empty --to-schema` never connects, so `lib/prisma-import.ts` writes a config that points at port 1 on loopback.
- **Prisma 7 rejects `url`, `directUrl` and `shadowDatabaseUrl` in schema files** (error P1012). Prisma 5 and 6 schemas have them, so `preparePrismaSchema` blanks those lines.
- **Do not drop a schema's generator blocks.** They carry `previewFeatures`; without them, `extensions = [...]` and `view` blocks fail to validate. `migrate diff` never runs generators.
- **`migrate diff --to-schema` needs a real file;** `/dev/stdin` is rejected. The SQL goes to stdout, and messages such as "Loaded Prisma config" go to stderr.
- **The WHATWG URL parser re-encodes passwords.** A `:` inside a password becomes `%3A`, which decodes to the same password. Compare decoded values.

## Safety

- **Rendered SQL contains raw fragments** from the snapshot: types, defaults, expressions, index definitions. Review it before executing. Never execute a plan built from a snapshot you did not produce or review.
- **PostgreSQL reprints what you type.** `int` becomes `integer`, `varchar(40)` becomes `character varying(40)`, `numeric(10, 2)` becomes `numeric(10,2)`, and index definitions come back in `pg_get_indexdef` form, quoted only where needed. A snapshot built from typed input would therefore never match an introspected one. The editor normalizes every draft through the shadow database.
- **Every new database has a `public` schema.** Shadow-database results ignore an empty `public` (unless the target version has one), so a Prisma import or a verification does not report a phantom namespace.
- **Shadow verification proves the plan against an empty copy of `from`,** not against real rows. A backfill value of the wrong type fails there (constants are cast when the statement runs), but duplicates or NULLs in real data can still make a statement fail. Views, triggers and other uncaptured objects are missing too.
- **Text in SQL comments** must go through `commentText`. A newline in an object name would otherwise end the `--` comment and turn the rest into SQL.
