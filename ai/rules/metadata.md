# Rules: the metadata database (prisma/)

Read before changing `prisma/`, `prisma.config.ts`, or any Prisma query. These rules add to AGENTS.md and never relax it.

## What it is

- **Skematron's own database.** It holds users, sessions, organizations, members, invitations, projects, environments, schema versions and audit events.
- **It is never a user's application database.**
  - Never point `SKEMATRON_DATABASE_URL` or any Prisma command at a user database.
  - Never introspect or migrate a user database with Prisma. That is the adapters' job, and it is read-only.

## Changing the schema

- **Change it only through Prisma migrations in `prisma/migrations`:**
  - `pnpm db:migrate --name <change>` in development.
  - `pnpm db:deploy` in production.
  - Commit the migration with the schema change.
- **Never edit an applied migration.** Add a new one.
- **Prefer expand-and-contract.** Add new columns and tables first and backfill them; remove old ones in a later release. Old and new app versions may briefly run against the same database.
- **Never store secrets in plaintext columns.** Encrypt with `lib/secrets.ts`, and keep a redacted hint for display.
- **Better Auth models** (`User`, `Session`, `Account`, `Verification`, `Organization`, `Member`, `Invitation`) are generated:
  - Regenerate them with `pnpm dlx auth@1.7.7 generate --config apps/web/lib/auth.ts --output prisma/schema.prisma --yes`, with the `.env` variables exported.
  - The generator rewrites the whole file and adds blank lines after `///` comments; remove those.
  - Do not add Skematron relations to Better Auth models. Skematron tables refer to them by id.
- **Skematron models** use `uuid(7)` ids and `@@map("snake_case")` table names.
- After any schema change, run `pnpm db:generate`. Install runs it too.

## Using it

- Scope every query to the actor's organization (see `ai/rules/web.md`).
- **Use transactions and locks where correctness depends on order.** Version numbering, for example, takes a per-project advisory lock. Unique constraints are the safety net.
- **Versions and audit events are append-only.** No update or delete paths.
- **Backups:** back up the metadata database, the artifact directory (`SKEMATRON_ARTIFACT_DIR`) and `SKEMATRON_SECRET_KEY` together (see `docs/self-hosting.md`).
