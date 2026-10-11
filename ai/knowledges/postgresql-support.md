# PostgreSQL support

Applies to the `@skematron/adapters` PostgreSQL adapter and the core planner, as of 2026-10-10.

## Versions

- PostgreSQL 14 or newer is required. Older servers are rejected with a clear error.
- Tested on 14.20.
- Version-specific behavior:
  - 15 and later: `UNIQUE NULLS NOT DISTINCT` is captured.
  - 18 and later: virtual generated columns are captured, and NOT NULL constraint rows (`contype = 'n'`) are folded into column nullability.

## How introspection runs

The caller passes a dedicated session. `introspectPostgres` then:

1. Opens `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`.
2. Pins, for this transaction only: `search_path = ''`, `statement_timeout` (30 s by default), `standard_conforming_strings = on`, `quote_all_identifiers = off`, `DateStyle = 'ISO, YMD'`, `IntervalStyle = postgres`, `TimeZone = UTC`, `extra_float_digits = 1`, `bytea_output = hex`.
3. Runs the catalog queries in `queries.ts`.
4. Always rolls back.

It reads `pg_catalog` only, never table rows.

By default every user namespace is captured; `namespaces: [...]` limits capture to those. Excluded:

- `information_schema` and `pg_*` namespaces
- namespaces and objects owned by extensions

## Captured

| Object | Properties |
| --- | --- |
| Namespace | name |
| Table (ordinary, permanent, not partitioned, not a partition or inheritance child) | name, comment |
| Column | name, ordinal position, type (`format_type`), nullability, default, identity (always / by default), generated expression (stored / virtual), explicit collation, comment |
| Primary key | name, columns, deferrability |
| Unique constraint | name, columns, NULLS NOT DISTINCT, deferrability |
| Check constraint | name, expression (`pg_get_expr`) |
| Foreign key | name, columns, referenced table and columns, ON UPDATE / ON DELETE, MATCH FULL, deferrability |
| Index (not backing a constraint) | name, unique, full definition (`pg_get_indexdef`) |
| Enum type | name, values in sort order |
| Sequence | name, data type, start, increment, min, max, cache, cycle, owning column (serial) |

Sequences that belong to identity columns are omitted; the column's `identity` implies them.

## Reported as unsupported (not captured)

Introspection returns these in `unsupported` as `{ kind, namespace, table, name }`:

| kind | Meaning |
| --- | --- |
| `view`, `materialized-view`, `foreign-table`, `composite-type` | Non-table relations |
| `partitioned-table`, `partition`, `inherited-table`, `unlogged-table` | Tables Skematron cannot model yet |
| `row-level-security` | RLS is enabled on a captured table. The flag is not captured. |
| `policy`, `trigger`, `rule` | Table-level objects |
| `function`, `procedure`, `aggregate`, `window-function` | Routines |
| `domain`, `range-type`, `base-type`, `collation`, `extension` | Types and other objects |
| `exclusion-constraint`, `check-no-inherit`, `foreign-key-set-columns` | Constraints the model cannot represent |
| `invalid-index` | An index left invalid, for example by a failed `CREATE INDEX CONCURRENTLY` |
| `sequence-of-unsupported-table` | A serial sequence owned by a table that is not captured |
| `relation-kind-<x>`, `constraint-type-<x>` | A catalog kind this version does not recognize |
| `migration-history` | A migration tool's history table (`_prisma_migrations`, `alembic_version`, …). Added by the dashboard, not by introspection: see "SQL scripts" below. |

## Not inspected at all

Neither captured nor reported:

- Roles, ownership and grants.
- Tablespaces, storage parameters, column statistics targets.
- Database-wide objects: event triggers, publications, subscriptions, foreign servers.
- Operators, operator classes, text search objects, extended statistics, casts.
- Identity sequence options.
- Constraint validation state (`NOT VALID`).

Treat these as limitations, not guarantees.

## SQL scripts (uploads)

The dashboard takes PostgreSQL SQL from any ORM or migration tool. `preparePostgresScript` (`packages/adapters/src/postgres/script.ts`) reads it; it executes nothing.

- **Splitting follows psql:** single and double quotes, `E''` strings, dollar quotes, nested `/* */` comments, parentheses (rule actions), and `BEGIN ATOMIC … END` bodies in `CREATE FUNCTION`/`PROCEDURE`. Each statement keeps the line it starts on, for error messages.
- **Skipped, because they cannot change a snapshot:**
  - ownership (`ALTER … OWNER TO`, `SET ROLE`, `SET SESSION AUTHORIZATION`) and privileges (`GRANT`, `REVOKE`, `ALTER DEFAULT PRIVILEGES`)
  - time limits (`SET statement_timeout = 0` and similar), so Skematron's own limits stay in force
  - comments on schemas and extensions
  - psql's setup commands (`\restrict`, `\unrestrict`, `\set`, …)
  - rows written to a migration tool's history table (`INSERT INTO schema_migrations`, `UPDATE alembic_version`)
- **Refused, with the line:** `COPY` (rows), statements about whole databases, roles, tablespaces, subscriptions or server settings, `LOAD`, and other psql commands such as `\connect` or `\i`. Statements that cannot run inside a transaction block (`CREATE DATABASE`) cannot hide inside `DO` blocks or functions either. The rest is not a sandbox: the shadow server's isolation is.
- **Running:** in a fresh shadow database, one statement at a time, in autocommit like psql. A migration ("changes only") runs after the base version has been recreated. The schema is then read over a new connection, so a transaction left open is rolled back, as when psql exits.
- **Migration history tables** are left out of the snapshot and reported as `migration-history`, for every schema read from outside: uploads and database imports alike. Only names no application would choose are listed (`MIGRATION_HISTORY_TABLES` in `packages/adapters/src/migration-history.ts`); a table that takes part in foreign keys stays.
- **Equivalent, not identical:** a migration adds columns at the end of a table, so a migrated schema and one created from scratch can differ in column positions, which planning ignores.
- **Tested against real output** of pg_dump, Drizzle, Knex, Django, Alembic and Prisma: `packages/adapters/src/postgres/fixtures/scripts/`.

## Planner behavior and risk

| Operation | Risk | Notes |
| --- | --- | --- |
| Create namespace, enum, sequence or table; add a nullable column; drop NOT NULL; set or drop a default; change or drop identity; drop an index or constraint; comments; add an enum value; rename a sequence; add a NOT NULL column with an answered backfill | safe | A new enum value cannot be used in the same transaction that adds it. A backfill fails if the value is not valid for the column's type. |
| Rename a table or column (answered rename question) | caution | Applications that still use the old name stop working once it runs. |
| SET NOT NULL; add a NOT NULL column without a default; add PK, unique, check or FK, or create an index, on an existing table; add identity to an existing column; change a sequence's type or range | caution | May fail on existing data or block writes. The warnings suggest NOT VALID or CONCURRENTLY where relevant. |
| Drop a table, column, namespace, sequence or enum; change a column's type or collation | destructive | Type changes have no USING clause. Add one during review if needed. |

Guided planning (`packages/core/src/questions.ts`):

- **Renames are asked, never guessed.** A missing table, column or sequence with same-shaped candidates becomes a question. Answered `rename`, the plan starts with `ALTER TABLE … RENAME TO`, `ALTER TABLE … RENAME COLUMN` or `ALTER SEQUENCE … RENAME TO`, then diffs as usual.
  - Index definitions and check expressions that name the old object are recreated, because the snapshot stores them verbatim.
  - A renamed serial table also asks about its sequence. Renaming the sequence keeps its counter; a new sequence would restart at 1.
- **Backfills:** an added NOT NULL column without a default on an existing table asks for a value. The answer renders `ADD COLUMN … DEFAULT '<value>'::<type> NOT NULL`, followed by `DROP DEFAULT`. The value is a literal, not an expression.

Known limitations:

- **Matching:** objects are matched by name. Without an answer, a rename appears as a drop plus a create. A table renamed in the same change as its columns is not offered as a rename.
- **Column position** is ignored, because PostgreSQL cannot reorder columns.
- **Recreation:** changed constraints and indexes are dropped and re-created (no CONCURRENTLY).
- **Foreign keys** that depend on a re-created key, or whose columns change type, are dropped and re-added around the change.
- **Reported as unsupported**, so the plan is incomplete:
  - enum values that were removed or reordered
  - any change to a generated column
- **Uncaptured dependents:** objects that aren't captured, such as views, can make drops or type changes fail at apply time. That fails safely, but review dependents first.

## Rendering

- Every identifier is quoted. Literals follow `quote_literal`: values with backslashes become `E''` strings.
- Snapshot fragments are inserted verbatim.
- `CREATE SCHEMA IF NOT EXISTS` lets exported DDL run on databases that already have the namespace, such as `public`.
- `CASCADE` is never rendered.
- The script has no BEGIN/COMMIT. Apply statements one by one, or wrap them yourself once you have checked the enum caveat above.
