# Rules: tests and fixtures

## Layout and naming

- Tests live next to the code: `*.test.ts` for unit tests, `*.integration.test.ts` for tests that need PostgreSQL.
- Use `node:test` and `node:assert/strict`. Do not add another test framework.
- Build snapshots with the helpers in `@skematron/core/testing`: `snapshot`, `namespace`, `table`, `column`, `foreignKey`, `sequence`.
- Web app logic is tested in `apps/web/lib/*.test.ts` with `node:test`, using a temporary directory and never `.local/snapshots`. When you change pages, also check them in a running dev server.
- SQL fixtures live in `packages/adapters/src/postgres/fixtures/` and use `__SCHEMA__` for the schema name.

## Integration tests and databases

- Integration tests run only when `SKEMATRON_TEST_DATABASE_URL` is set. Otherwise they skip with a visible reason.
- Point the URL only at a dedicated, disposable database. `pnpm db:test:start` runs one locally (see AGENTS.md "Development").
- Every test creates its own `skematron_test_<random>` schema, works only inside it, and drops only that schema; the drop is guarded by the prefix.
- Never touch other schemas, roles or databases. The test database may also contain a `demo` schema from `pnpm db:test:seed`. Tests must neither read it nor depend on it, so always introspect with `namespaces: [schema]`.
- Never use production data or real customer schemas as fixtures.

## What to test

- Failure paths of safety-sensitive code: rollback on error, rejected input, unsupported changes.
- For a new PostgreSQL object or property:
  - an introspection assertion
  - the export round trip: rendered DDL recreates an identical checksum
  - the migration round trip, if the planner can change the object: after applying the plan, the result is equivalent to the target
- Determinism: shuffled input gives identical output.

## Before finishing

- `pnpm check` must pass.
- When you touch the adapter, planner or renderer, also run the integration tests against the local test cluster.
