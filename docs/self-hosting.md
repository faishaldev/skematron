# Self-hosting Skematron

Status: pre-alpha. This describes running the dashboard (`apps/web`) for one team, in single-organization mode. Docker Compose packaging is planned but not available yet.

## What you need

- Node.js 24 and pnpm 10.
- PostgreSQL 14 or newer for Skematron's **metadata database**. Use a dedicated database: never one of the application databases you want to manage.
- A persistent directory for **artifacts**: schema snapshots, about a few kilobytes per version.
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

## Backups

**Back up these three together.** Each is incomplete without the others:

1. **The metadata database** (`pg_dump` of `SKEMATRON_DATABASE_URL`).
2. **The artifact directory** (`SKEMATRON_ARTIFACT_DIR`). Versions point to artifacts by checksum.
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
- Applying migrations.
