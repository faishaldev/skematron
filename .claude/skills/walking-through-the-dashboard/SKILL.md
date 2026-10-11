---
name: walking-through-the-dashboard
description: Click through a dashboard flow end to end over HTTP against a production build with its own scratch metadata database, without touching the developer's dev server or data. Use after changing dashboard pages, server actions or route handlers.
---

# Walking through the dashboard

## Objective

Prove that a changed flow works in the real app (pages, forms, server actions, redirects, permissions) without touching the developer's own `pnpm web` session, dev database or artifacts.

Read `ai/rules/web.md` and `ai/rules/testing.md` first.

## Steps

1. **Leave the developer's setup alone.**
   - Check with `lsof -nP -iTCP:3100 -sTCP:LISTEN`. A running `next dev` belongs to the developer: do not stop it.
   - The developer may also start using your scratch server. If its database gains data you did not create (for example an organization set up in `/setup`), leave that server and database alone, use another port and database name, and ask before removing them. Do not run `next build` while their `next start` runs from the same `.next`; check layout changes with `next dev` on another port instead.
   - Never create test accounts or data in the `skematron` dev database.
2. **Build.** Run `pnpm --filter @skematron/web build`. It can run next to `next dev`, because Next 16 keeps dev output in `.next/dev`. The build must pass anyway.
3. **Make a scratch metadata database** in the local cluster (`pnpm db:start` first), with a name you will drop later, for example `skematron_e2e`:
   - `CREATE DATABASE skematron_e2e` through `psql -h "$PWD/.local/postgres" -p 54329 -d postgres`.
   - `SKEMATRON_DATABASE_URL="postgresql://$(id -un)@localhost:54329/skematron_e2e?host=$PWD/.local/postgres" pnpm exec prisma migrate deploy`
4. **Start the build on another port,** from `apps/web`, in the background:
   - `next start --hostname 127.0.0.1 --port 3101`
   - Set `SKEMATRON_DATABASE_URL` (the scratch database), `SKEMATRON_ARTIFACT_DIR` (a scratch directory) and `BETTER_AUTH_URL=http://127.0.0.1:3101`. Already-set variables win over `.env`; the rest (secrets, shadow and test URLs) come from `.env`.
5. **Script the flow** in a scratch `.mjs` file, never in the repository. Write it with a file-writing tool, not an unquoted shell heredoc: the shell would run the script's template literals as commands. Drive it like a browser:
   - Keep cookies per person (owner, admin, member, viewer) and send them on every request; use `redirect: "manual"` and read `location`.
   - To submit a form, fetch the page, find the `<form>` that contains the button, copy its hidden inputs (including `$ACTION_ID_…`), set the visible fields yourself, and POST it to the same path with `Origin: http://127.0.0.1:3101`.
   - Set the clicked button's `name`/`value` yourself (for example `verdict`). Upload files as `Blob` parts of the `FormData`.
   - For permission checks, take the form from a privileged person's page and post it with the other person's cookies; expect the `?error=` redirect.
   - Before matching page text, strip `<!-- -->` and decode HTML entities (`gotchas.md`, Next.js section).
   - Start with `/setup`, then invite the other people from `/settings/members` and join through the invitation links.
   - End with checks on the audit log, and that no `skematron_shadow_*` databases or secrets were left behind.
6. **Look at it, for layout changes.** Text checks do not show whether a page is understandable. Take screenshots with the installed Google Chrome in headless mode through the DevTools protocol (Node's built-in `WebSocket`): set the session cookies with `Network.setCookie`, emulate light and dark with `Emulation.setEmulatedMedia`, and capture full pages with `Page.captureScreenshot`. Keep the script and images in the scratch directory, and look at both color schemes.
7. **Clean up.**
   - Stop the port 3101 server.
   - `DROP DATABASE skematron_e2e WITH (FORCE)`, and remove the scratch artifact directory.
   - Confirm that only `postgres`, `skematron`, `skematron_test` and the templates remain.

## Done when

- Every check in the script passes against the production build.
- The developer's dev server, dev database and artifacts are unchanged, and the scratch database is gone.
