# Changelog

All notable changes to Skematron are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `pnpm check` requires an entry for every change to source, scripts or configuration.

## [Unreleased]

### Added

- **Workspace.**
  - A pnpm monorepo on Node 24 that runs TypeScript natively, with no build step.
  - `node:test` for tests, `tsc` for type checks, Prettier for TS, JSON and YAML.
  - `pnpm check` runs all of these.
- **`@skematron/core` snapshot format v1.**
  - Describes namespaces, tables, columns, primary keys, unique, check and foreign key constraints, indexes, enums and sequences.
  - Validated canonical form and canonical JSON serialization.
  - `sha256:` checksums computed with Web Crypto.
- **`@skematron/core` `planMigration`.**
  - Compares two snapshots and returns ordered operations, each with a `safe`, `caution` or `destructive` risk level and warnings.
  - Lists differences it cannot express (such as removed enum values or changed generated columns) instead of skipping them.
- **`@skematron/adapters` `introspectPostgres`.**
  - Reads a PostgreSQL 14+ schema in a read-only transaction that is always rolled back. It queries only the system catalog.
  - Pins session settings so snapshots are deterministic.
  - Reports views, functions, triggers, partitioned tables and other objects it does not capture.
- **`@skematron/adapters` `renderPostgresMigration`.**
  - Turns a plan into SQL statements and a review script that summarizes unsupported changes and destructive operations.
  - Identifiers are always quoted, and `CASCADE` is never rendered.
- **Tests.**
  - Unit tests for canonicalization, planning, rendering and introspection.
  - PostgreSQL integration tests: exported DDL recreates an identical checksum, and a v1 → v2 migration reaches an equivalent schema.
  - Dashboard tests:
    - unit tests for permissions, encryption, URL validation and redaction
    - integration tests against a throwaway metadata database: the sign-up gate, invitations, organization scoping, encrypted storage, and concurrent version numbering
- **Local PostgreSQL (`pnpm db:start` / `db:stop`).**
  - A disposable, socket-only cluster in `.local/`, with a metadata database (`skematron`) and a test database (`skematron_test`).
  - It adds missing `.env` keys with generated secrets.
  - The earlier `db:test:*` names still work.
- **Dashboard (`apps/web`, `pnpm web`)**, built on Next.js 16, Better Auth and Prisma 7. It runs in single-organization mode for self-hosting:
  - **Accounts:** first-run setup at `/setup` creates the organization and its owner. After that, people join only through invitation links.
  - **Roles:** viewer, member, admin and owner, enforced on the server for every page, action and download. Admins manage members on the Members page.
  - **Projects and environments:** an environment is a database target. Its connection URL is stored encrypted (AES-256-GCM) and only ever shown redacted.
  - **Importing:** reads a version from an environment, read-only. Versions are immutable, numbered per project, and stored as checksum-verified artifacts. An unchanged schema creates no new version.
  - **Comparing:** browse any version, compare two versions, or check an environment for drift as a risk-rated migration. Export SQL or the snapshot JSON.
  - **Audit log:** setup, invitations, role changes, project and environment changes, and imports.
- **Metadata database** for Skematron's own data (`prisma/`): `pnpm db:migrate` in development, `pnpm db:deploy` in production. `docs/self-hosting.md` covers configuration, backups and upgrades.
- **`@skematron/storage`:** a content-addressed artifact store whose writes are atomic and never overwrite, and whose reads are verified against their checksum.
- **`pnpm db:seed v2`** loads the changed sample schema, so you can try Compare.
- **Try the libraries without the dashboard.**
  - `pnpm db:seed` loads a sample `demo` schema into the test database.
  - `pnpm example:export [schema…]` reads a schema (read-only) and prints its checksum, the objects it could not capture, and the SQL that recreates it. Set `DATABASE_URL` to read your own database instead.
- **AI docs** for Claude Code, Codex and other agents:
  - rules in `ai/rules/`
  - skills in `ai/skills/` (`documenting-changes`, `extending-postgres-support`, `walking-through-the-dashboard`), copied to `.claude/skills` and `.codex/skills` by `pnpm sync:ai`
  - knowledges in `ai/knowledges/`
- **Documentation gate (`pnpm check:docs`).** Fails when source changes lack a CHANGELOG entry or when the skill copies drift from `ai/skills`.
- **Guided migration plans in `@skematron/core`.**
  - `planMigration(from, to, { answers })` now also returns `questions`, instead of silently turning renames into drops:
    - Was a missing table, column or sequence renamed? Candidates are new objects of the same shape.
    - What value should existing rows get in a new NOT NULL column?
  - Answers turn drop-plus-create into `rename-table`, `rename-column` or `rename-sequence` operations, and fill new NOT NULL columns through a temporary default. Rows and sequence counters are kept.
  - Invalid answers, and answers that match no question, are rejected.
  - Helpers: `openQuestions` and `answersOf`.
- **`@skematron/adapters` Prisma Schema adapter:** `preparePrismaSchema` checks for one PostgreSQL datasource and removes connection URLs, so Prisma 5, 6 and 7 schemas can be imported.
- **Dashboard: import `schema.prisma` as a version.**
  - Upload or paste the file on the project page. Prisma's own CLI turns it into SQL, which runs in a throwaway shadow database; Skematron reads the result.
  - The stored schema file (without connection URLs) can be downloaded from the version page.
- **Dashboard: migrations.**
  - Create a migration between two versions, answer its questions in the browser, and see the plan and SQL for each revision.
  - Every revision is immutable and is checked in a shadow database: the starting version is recreated, the plan runs statement by statement, and the result must match the target version.
  - Submit for review once there are no open questions or unsupported changes and the check passed.
  - An admin or owner who wrote neither the migration nor the revision approves or rejects it. Approving destructive operations needs an explicit acknowledgment; rejecting needs a comment. Changing anything makes a new revision, which goes back to draft.
  - Download the reviewed script as `migration.sql`. Skematron does not run it yet.
  - New permissions: `author-migrations` (member and up) and `review-migrations` (admin and up). Migration steps are recorded in the audit log.
- **Shadow database (`SKEMATRON_SHADOW_DATABASE_URL`).** A dedicated, disposable PostgreSQL server where Skematron creates and drops temporary `skematron_shadow_*` databases. It refuses a superuser role. `pnpm db:start` creates a `skematron_shadow` role locally and adds the variable to `.env`. See `docs/self-hosting.md`.
- **Sample Prisma schemas** in `packages/adapters/src/prisma/fixtures/` for trying migrations.
- **Dashboard: a schema editor** for projects whose schema is written in the dashboard.
  - Each project now has a **schema source**:
    - "code": versions are imported from a `schema.prisma` or an environment.
    - "dashboard": people edit the schema in Skematron.
  - The source is chosen when the project is created. Admins can change it on the project page.
  - In the editor, add tables (with an ID column), columns (type, required, default, unique), indexes and foreign keys. Changes go into your own private draft.
  - Every change is checked by PostgreSQL in a shadow database:
    - Types and defaults are stored the way PostgreSQL prints them (`int` becomes `integer`).
    - Mistakes such as an unknown type are rejected with PostgreSQL's message.
  - **Save as version** records the draft as the next version, then leads to a new migration from the version it started from. If someone else saved a version in the meantime, saving is refused, so their changes are never overwritten.
  - Importing a `schema.prisma` works only for "code" projects, and the editor only for "dashboard" projects, so a project never has two sources of truth.
- **`@skematron/core` schema editing:** `addTable`, `addColumn`, `addUniqueConstraint`, `addIndex` and `addForeignKey` return a new, validated snapshot.
- **`@skematron/adapters` `renderIndexDefinition`:** the `CREATE INDEX` statement for a new B-tree index, with every name quoted.
- **Schemas from any ORM or migration tool, as SQL.** Projects whose schema is written in code now take PostgreSQL SQL, not only `schema.prisma`:
  - **The whole schema**, for the first version or a branch: `pg_dump --schema-only`, Rails' `structure.sql`, `drizzle-kit export`, `alembic upgrade head --sql`, and so on. It runs in an empty shadow database.
  - **Migrations (only the changes)**, for a branch: Django's `sqlmigrate`, a Prisma `migration.sql`, `alembic upgrade <from>:<to> --sql`. They run on top of the branch's base version. Each upload starts again from that version, so uploading a fixed migration replaces it.
  - Ownership, privileges, time limits and psql's own commands in a dump are skipped. Scripts with rows (`COPY`) or statements about whole databases, roles or the server are refused, with the line. A statement that fails is named with its number, line and PostgreSQL's message.
  - Only the script's checksum is kept, never the script. Uploads are limited to 1 MB.
  - The import and upload pages have a "How do I get SQL from my ORM or migration tool?" panel.
  - Tested against real output of pg_dump, Drizzle, Knex, Django, Alembic and Prisma.
- **`@skematron/adapters` `preparePostgresScript`:** splits a PostgreSQL script the way psql does (quotes, dollar quotes, nested comments, `BEGIN ATOMIC` bodies) and sorts its statements into run, skip and refuse.
- **`@skematron/adapters` `withoutMigrationHistory`** and `MIGRATION_HISTORY_TABLES`: the history tables of Prisma, Drizzle, Alembic, Django, Rails, Knex, Kysely, Sequelize, MikroORM, node-pg-migrate, Flyway, Liquibase, goose, SQLx and Entity Framework Core.

### Changed

- **Migration tools' history tables are no longer tracked.** `_prisma_migrations`, `alembic_version`, `django_migrations`, `schema_migrations` and similar tables are left out of database imports, drift checks and uploads, and listed as not tracked. A database and a schema file of the same app now compare as equal. Versions imported earlier still contain them, so the next import shows them as removed once.
- **Prisma's SQL runs one statement at a time** in the shadow database, so an error names the statement and its line.
- **Buttons and steps no longer assume Prisma:** "Import a schema file" for the first version, and "Upload changes" on branches, with a choice of SQL migrations, SQL of the whole schema, or a `schema.prisma`. The upload page preselects the kind the branch, or its base version, last used.
- **A sidebar and schema diagrams make the dashboard easier to find your way around.**
  - **The sidebar** starts with a project switcher (the current project, with every project, "View all projects" and "New project" in its menu). Below it are the current project's sections, with icons and the number of open branches. They stay visible on every page: outside a project, the sidebar shows the last project you opened:
    - Overview: the next step, counts, open branches, and a diagram of main
    - Branches, Main versions, Diagram, Databases, and Settings (for admins)

    Below them are Members, the Audit log and your account.
  - **Diagrams:**
    - Tables with their columns, keys and links, drawn so that tables others point to are on the left.
    - On the new Diagram page, pick any version or open branch. Versions show a diagram first, with a Tables tab for details.
    - On branches and in the schema editor, new tables and columns are green and changed tables amber.
- **Schema changes now go through branches, like git.**
  - **Main:** the line of approved versions. Its first version (the baseline) is imported from a `schema.prisma` or a database. After that, main only changes by merging a branch.
  - **Branches:**
    - Start one from the latest version on main, then change it in the schema editor or by uploading a `schema.prisma`.
    - Skematron shows the changes, asks its questions and test-runs them.
    - After a review by someone who did not work on it, merge it to make the next version, or close it if it is not needed: nothing reaches main.
    - Branches are shared, so teammates can work on them together; changes made at the same time never overwrite each other.
    - If main moves on while a branch is open, rebase the branch onto the newest version before merging.
  - **Importing a database** that differs from main now creates a branch (`from-<environment>`), so the difference is reviewed before it reaches main.
  - Existing schema editor drafts became open branches. The separate "New migration between two versions" page and private drafts are gone.
- **The dashboard is easier to follow.**
  - **Every page:** breadcrumbs, a clear title, and the main buttons at the top right.
  - **Project page:** an overview that says what to do next (for example "M2 is not submitted yet", or "v3 has no migration yet"), with counts of versions, migrations and databases. Project settings are folded away.
  - **Migration page:**
    - Progress steps: answer questions, test run, review, approved.
    - One box with the next step. Reviewers approve or reject right there.
    - Questions are written as plain choices ("Yes, renamed to displayName: keeps the existing data").
  - **Changes in plain language:** "Rename column User.fullName to displayName", "Delete column Post.published and its data". The SQL of each change, technical steps, the full script and the history are one click away.
  - **Schema editor:** your changes and the schema are on the left, and the "Add a table / column / foreign key / index" forms in a side panel.
  - **Versions:** a summary of tables, columns and enums. Columns read as type, required and default. Keys, links and indexes are shown as labels. Sequences, checksums and downloads are folded away.
  - **Other pages:**
    - Projects are listed as cards that fill the page, each with its schema source, its latest version on main, and its open branches and databases.
    - A new project is created on its own page (`/projects/new`, from "New project" on the list or in the project switcher), choosing its schema source from two described options.
    - The "In code" schema source is described for any ORM or migration tool (changes come from a connected database or an uploaded schema file), instead of as a `schema.prisma`. Prisma is named only as the schema file format supported so far.
    - Sign-in, setup and invitations are a centered card.
    - Light and dark mode are both polished.

### Fixed

- **Forms with a file input no longer run off the side of the screen on phones.**
- **A test run, import or upload no longer fails at random when PostgreSQL's autovacuum visits the shadow database.** The role could not end that session, so dropping the temporary database failed ("must be a member of the role whose process is being terminated") and the database was left behind. The drop is now retried for a few seconds.

- **A running `pnpm web` no longer fails with "Cannot read properties of undefined (reading 'findMany')" after a metadata schema change.** The dashboard rebuilds its Prisma client when the generated client changes, instead of keeping the old one across hot reloads.
