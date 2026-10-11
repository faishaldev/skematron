# SQL script fixtures

These scripts are real output of the tools people upload schemas from. They are kept as the tools wrote them, so the script splitter (`../../script.ts`) and the dashboard's SQL import are tested against what those tools really produce. The only edit: the owner role in `pg-dump.sql` was renamed to `app_owner`.

Every whole-schema script describes the same small blog: `users` (with a `role` enum) and `posts`, which points at `users` and has an index on `author_id`. Django's version has no enum, and Prisma's comes from `../../../prisma/fixtures/`.

| File | Tool | How it was made |
| --- | --- | --- |
| `pg-dump.sql` | pg_dump 14.20 | `pg-dump-source.sql` run with psql, then `pg_dump --schema-only` (with owners and privileges, so the skipped statements are tested). It also has a `citext` extension, a view, functions (one with a `BEGIN ATOMIC` body), a trigger, and `schema_migrations`, a migration history table. |
| `drizzle-export.sql` | drizzle-kit 0.31.11 | `drizzle-kit export --dialect=postgresql --schema=./schema.ts` |
| `knex.sql` | Knex 3.3.0 | `knex.schema.createTable(...).toSQL()`, statements joined with `;` |
| `django-0001.sql`, `django-0002.sql` | Django 5.2.18 | `python manage.py sqlmigrate blog 0001` (whole schema) and `0002` (adds `posts.summary`: changes only) |
| `alembic-head.sql`, `alembic-0001-0002.sql` | Alembic 1.20.0 | `alembic upgrade head --sql` with only revision 0001 (whole schema), and `alembic upgrade 0001:0002 --sql` (adds `posts.summary`: changes only, plus an `UPDATE alembic_version`) |
| `prisma-v1.sql`, `prisma-v1-to-v2.sql` | Prisma 7.10.0 | `prisma migrate diff --from-empty --to-schema v1.prisma --script`, and `--from-schema v1.prisma --to-schema v2.prisma --script` (a migration: changes only) |

To regenerate one, install the tool in a scratch directory outside the repository, never as a dependency of Skematron, and run its command against a scratch database if it needs one.
