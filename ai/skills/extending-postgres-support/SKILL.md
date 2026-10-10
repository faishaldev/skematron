---
name: extending-postgres-support
description: Add support for a PostgreSQL schema object or property end to end - snapshot model, canonicalization, planner, SQL renderer, catalog introspection, tests and docs. Use when Skematron must capture something it currently reports as unsupported, or a property it ignores.
---

# Extending PostgreSQL support

## Objective

Capture a new PostgreSQL object or property so that it round-trips: introspecting, planning, rendering and applying, then introspecting again, gives an equivalent schema.

Read `ai/rules/core.md`, `ai/rules/adapters.md` and `ai/rules/testing.md` first.

## Steps

1. **Scope it.**
   - Check `ai/knowledges/postgresql-support.md`.
   - Decide exactly what is captured, which PostgreSQL versions have it, and what stays reported as unsupported.
   - Prefer the smallest model that round-trips.
2. **Model (`packages/core/src/snapshot.ts`).**
   - Add the fields or types. This changes the snapshot's shape, so first plan the format version change described in `ai/knowledges/snapshot-format.md`: a new `formatVersion`, a way to read older documents, and a new golden test.
   - Record the decision in `decisions.md`.
3. **Canonicalization (`canonical.ts`).**
   - Rebuild the new fields explicitly.
   - Sort named collections with `sortedByName`.
   - Validate names and references.
   - Extend `canonical.test.ts`.
4. **Planner (`plan.ts`).**
   - Add operation kinds, a phase in `Phase` that respects dependencies, and a risk level with warnings for each.
   - Put anything you cannot express in `unsupported`.
   - Add `plan.test.ts` cases for order, risk and unsupported changes.
5. **Renderer (`packages/adapters/src/postgres/render.ts`).**
   - Render each new operation, quoting identifiers and literals.
   - Add expected-SQL cases to `render.test.ts`.
6. **Introspection (`queries.ts`, `introspect.ts`).**
   - Read the catalog with explicit casts and JSON lists. Gate version-specific columns on `server_version_num`.
   - Map rows with the validating helpers (`text`, `bool`, `int`, `textList`).
   - Stop reporting what is now captured, and keep reporting the parts that are not.
   - Extend `introspect.test.ts` with fake rows.
7. **Integration.**
   - Add the object to `fixtures/v1.sql`. If the planner can alter it, add a change to `fixtures/v2.sql`.
   - Run `pnpm db:start`, then `pnpm test`. Both round trips must pass.
8. **Document.**
   - Update `postgresql-support.md` (captured, unsupported, risks).
   - Update `snapshot-format.md` if the shape changed.
   - Add catalog surprises to `gotchas.md`, and an entry to `CHANGELOG.md`.
   - Then run the `documenting-changes` skill.

## Done when

- Unit and integration tests pass.
- The export and migration round trips cover the new object.
- The support matrix in `postgresql-support.md` is accurate.
