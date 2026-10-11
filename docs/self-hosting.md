# Self-hosting Skematron

Status: pre-alpha. This describes running the dashboard (`apps/web`) for one team, in single-organization mode. Docker Compose packaging is planned but not available yet.

## What you need

- Node.js 24 and pnpm 10.
- PostgreSQL 14 or newer for Skematron's **metadata database**. Use a dedicated database: never one of the application databases you want to manage.
- A persistent directory for **artifacts**: schema snapshots, Prisma schema files, and migration plans and scripts, a few kilobytes each.
- A separate, disposable PostgreSQL 14+ server for **shadow databases**, if you want Prisma schema import and migration checks (see below).
- TLS in front of the app (a reverse proxy such as Caddy or nginx). Never expose the dashboard over plain HTTP.

## Configuration

Set these environment variables for the app process, for example in a git-ignored `.env` at the repository root:

| Variable | Required | Meaning |
| --- | --- | --- |
| `SKEMATRON_DATABASE_URL` | yes | The metadata database, e.g. `postgresql://skematron:…@db:5432/skematron`. |
| `SKEMATRON_SECRET_KEY` | yes | Encrypts stored database connection URLs. Generate it with `openssl rand -base64 32`. |
| `BETTER_AUTH_SECRET` | yes | Signs sessions. Generate it with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes | The public URL of the dashboard, e.g. `https://skematron.example.com`. Also used in invitation links. |
| `SKEMATRON_ARTIFACT_DIR` | in production | Directory for artifacts, e.g. `/var/lib/skematron/artifacts`. |
| `SKEMATRON_SHADOW_DATABASE_URL` | for migrations | The shadow server's maintenance database, e.g. `postgresql://skematron_shadow:…@shadow:5432/postgres`. Without it, Prisma import and the schema editor are unavailable, and migration checks are recorded as "unavailable", which blocks submitting migrations. |

## Install and run

Install, apply the metadata migrations, build, then start the app:

```sh
pnpm install --frozen-lockfile
pnpm db:deploy
pnpm --filter @skematron/web build
pnpm --filter @skematron/web start
```

- `start` listens on `127.0.0.1:3100`. Put your TLS reverse proxy in front of it.
- Then open `/setup` to create the organization and its owner account. After that, people join only through invitation links that admins create on the Members page.

## Databases you manage

- Add a database as an **environment** of a project. Skematron only reads its schema: introspection runs in a read-only transaction and never touches table data.
- Give it a database user with the least privileges possible. Read access to the system catalogs is enough.
- Connection URLs are stored encrypted with `SKEMATRON_SECRET_KEY`. After saving, only a redacted form (without the password) is shown.

## The shadow database server

Skematron runs SQL that comes from users (uploaded SQL scripts, Prisma's DDL, schema editor drafts, migration plans) to check what it really does. It does this only in temporary databases on a server you dedicate to it, never on the databases you manage and never on the metadata database.

- **Use a separate PostgreSQL 14+ server or container that holds nothing else.** It needs no backups or persistent volume.
- **Create a role that can create databases and is not a superuser.** Skematron refuses a superuser role.

  ```sql
  CREATE ROLE skematron_shadow LOGIN PASSWORD '…' CREATEDB NOSUPERUSER NOCREATEROLE;
  ```

- **Point `SKEMATRON_SHADOW_DATABASE_URL` at that server's `postgres` database** with this role.
- **Members can run their own SQL there,** by uploading a schema or a migration. Skematron refuses statements about databases, roles, tablespaces and server settings, and `COPY`, but that is not a sandbox: the dedicated server and the non-superuser role are what keep it contained.
- **What happens in it:** each upload, each Prisma import and each migration revision creates a `skematron_shadow_<random>` database, works in it with statement timeouts, and drops it again. If an autovacuum worker is visiting the database at the end, the drop is retried for a few seconds, because a non-superuser role cannot end that worker. If the app is killed mid-run, a leftover `skematron_shadow_*` database can be dropped by hand.
- **Extensions:** a check recreates the extensions the starting version reports, such as `citext` or `pgcrypto`, so they must be installable on the shadow server. As a non-superuser role, it can create only trusted extensions.
- **SQL uploads** are limited to 1 MB. The script itself is never stored, only its checksum. For a larger schema, connect the database and import it instead.
- **The Prisma CLI** (installed with the app) turns `schema.prisma` files into SQL. It runs in a temporary directory, without access to Skematron's secrets, and never connects to a database.

## Backups

**Back up these three together.** Each is incomplete without the others:

1. **The metadata database** (`pg_dump` of `SKEMATRON_DATABASE_URL`).
2. **The artifact directory** (`SKEMATRON_ARTIFACT_DIR`). Versions and migration revisions point to artifacts by checksum.
3. **`SKEMATRON_SECRET_KEY`.** Without it, stored connection URLs cannot be decrypted, and must be entered again.

**To restore:** restore the database and the artifact directory, then set the same `SKEMATRON_SECRET_KEY`. Every artifact is verified against its checksum when it is read, so a missing or damaged file is reported, never silently served.

## Upgrades

1. **Read the release notes.** Back up as described above.
2. **Stop the app,** update the code, and run `pnpm install --frozen-lockfile`.
3. **Run `pnpm db:deploy`.** It applies Skematron's own metadata migrations only. It never touches the databases you manage.
4. **Build and start again.**

Rolling back after a metadata migration is not guaranteed to be safe. Restore from the backup instead of only switching back to the old code.

## Not yet supported

- Docker Compose packaging.
- Email delivery: invitations are links you share yourself, and there is no password reset yet.
- SSO/OAuth.
- Multiple organizations.
- The CLI.
- Applying migrations to environments. Migrations can be created, checked and approved, and their SQL downloaded, but Skematron does not run them yet.
