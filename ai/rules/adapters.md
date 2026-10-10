# Rules: packages/adapters

Read before changing anything in `packages/adapters/`. These rules add to AGENTS.md and never relax it.

## Boundaries

- Adapters import only their own modules and `@skematron/core`. `src/boundaries.test.ts` enforces this.
- Database drivers (`pg`) are devDependencies, used by integration tests only. Callers pass in a session (`PostgresSession`), so the adapter never owns a connection.
- No edition, entitlement, billing, credential-storage or connection-policy (SSRF) logic. That belongs to the app that owns the connection.
- Keep schema-tool adapters (Prisma Schema, SQL DDL) separate from database adapters (PostgreSQL) when they are added.

## Introspection is read-only

- Run inside `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` with the pinned session settings (`sessionSettingsQuery`).
- Always `ROLLBACK`, including on failure, and keep the original error.
- Query `pg_catalog` only. Never read table rows, call functions with side effects, or write anything.
- Keep all SQL in `postgres/queries.ts`. Start each query with a `/* skematron:<name> */` marker.
- Cast every result column (`::text`, `::int4`, `::bool`) and return lists as JSON text, so mapping never depends on the driver's type parsing. Validate every field while mapping rows.
- Gate catalog columns that exist only in newer versions on `server_version_num`. The minimum supported version is PostgreSQL 14.
- Report everything that is not captured in `unsupported`; never drop an object silently. Document every new kind in `ai/knowledges/postgresql-support.md`.

## SQL rendering

- Quote every identifier with `quoteIdent`/`quoteQualified` and every string literal with `quoteLiteral`. Never concatenate unquoted names or values into SQL.
- Raw fragments from the snapshot are inserted verbatim. Validate anything that is not a fragment; for example, sequence numbers must be integers.
- Pass text placed after `--` through `commentText`, so a line break cannot end the comment and turn the rest into SQL.
- Rendering never executes anything and never adds BEGIN/COMMIT. Execution belongs to a future, explicitly authorized apply step.
- Never render `CASCADE`.
