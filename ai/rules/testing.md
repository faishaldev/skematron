# Rules: tests and fixtures

## Layout and naming

- Tests live next to the code: `*.test.ts` for unit tests, `*.integration.test.ts` for tests that need PostgreSQL.
- Use `node:test` and `node:assert/strict`. Do not add another test framework.
- Build snapshots with the helpers in `@skematron/core/testing`: `snapshot`, `namespace`, `table`, `column`, `foreignKey`, `sequence`.
- **Web app tests** live in `apps/web/lib/*.test.ts`:
  - Pure modules: `policy.test.ts`.
  - The metadata layer: `metadata.integration.test.ts`.
  - Shadow databases, Prisma import and the migration workflow: `migrations.integration.test.ts`.
  - Shared setup is in `test-support.ts`.
  - Use temporary directories, never `.local/artifacts`.
- SQL fixtures live in `packages/adapters/src/postgres/fixtures/` and use `__SCHEMA__` for the schema name.
- Prisma schema fixtures live in `packages/adapters/src/prisma/fixtures/`.

## Integration tests and databases

- **Integration tests run only when `SKEMATRON_TEST_DATABASE_URL` is set.** Otherwise they skip with a visible reason.
- **Point the URL only at a dedicated, disposable database.** `pnpm db:start` runs one locally (see AGENTS.md "Development").
- **Adapter tests use their own schema.** Each test creates its own `skematron_test_<random>` schema, works only inside it, and drops only that schema; the drop is guarded by the prefix.
- **Migration tests also need `SKEMATRON_SHADOW_DATABASE_URL`.** They check that no `skematron_shadow_*` database is left behind.
- **Metadata tests use their own database.** They create a `skematron_it_<random>` database on the same server, migrate it with `prisma migrate deploy`, and drop it afterwards.
  - Refuse to migrate any other database.
  - `process.loadEnvFile` never overrides variables you set, so pass `SKEMATRON_DATABASE_URL` explicitly.
- **Never touch other schemas, roles or databases.**
  - The test database may contain a `demo` schema from `pnpm db:seed`. Tests must neither read it nor depend on it, so always introspect with `namespaces: [schema]`.
  - The `skematron` database belongs to local development; tests never use it.
- Never use production data or real customer schemas as fixtures.

## What to test

- **Failure paths** of safety-sensitive code: rollback on error, rejected input, unsupported changes.
- **Authorization:** every permission in `lib/roles.ts`, and organization scoping (an outsider gets "not found").
- **Secrets:** the plaintext never appears in stored rows, hints, audit details or error messages.
- **For a new PostgreSQL object or property:**
  - an introspection assertion
  - the export round trip: rendered DDL recreates an identical checksum
  - the migration round trip, if the planner can change the object: after applying the plan, the result is equivalent to the target
- **Determinism:** shuffled input gives identical output.

## Before finishing

- `pnpm check` must pass.
- When you touch the adapter, planner or renderer, run the integration tests against the local cluster.
- **When you touch dashboard pages, also click through the changed flow.** Follow the `walking-through-the-dashboard` skill: a production build on another port with a scratch metadata database, so the developer's own dev server and data stay untouched.
