---
name: documenting-changes
description: Document a Skematron change before finishing it - CHANGELOG entry, knowledges, decisions, gotchas, rules and skills - then sync the skill copies and pass the docs gate. Use at the end of every change, or when `pnpm check:docs` fails.
---

# Documenting changes

## Objective

Leave the documentation as accurate as the code, in the same change. This skill carries out `ai/rules/documentation.md`.

## Steps

1. **See what changed.**
   - Run `git status --short` (it includes untracked files) and `git diff --stat`.
   - Classify each change as a new capability, changed behavior, removal, fix, security fix, or internal only.
2. **CHANGELOG.md.**
   - Under `## [Unreleased]`, add one bullet per change, in the right section: Added, Changed, Deprecated, Removed, Fixed or Security.
   - Write for users: "You can now…", "X now…".
   - Internal changes to source, scripts or config still get a short bullet, because the docs gate requires it.
   - Never edit released sections.
3. **Knowledges.** Open `ai/knowledges/README.md` and check each page the change touches:
   - New package, module, boundary or data flow: `architecture.md`.
   - Snapshot shape, canonicalization or checksum: `snapshot-format.md`. This also requires a new format version; see `ai/rules/core.md`.
   - PostgreSQL objects, properties or planner behavior: `postgresql-support.md`.
   - A new term: `glossary.md`.
   - Any effect on editions, licensing or SaaS vs. self-hosted: `business-model.md`.
4. **Decisions.**
   - If you chose between real alternatives, append a dated entry to `decisions.md` with Context, Decision and Consequences.
   - Do not edit a superseded entry. Add a new entry that says what it supersedes.
5. **Gotchas.** Add anything that surprised you or cost time to `gotchas.md`, together with the fix or workaround.
6. **Rules.**
   - If a convention changed, update the matching file in `ai/rules/`.
   - For repository-wide facts, update AGENTS.md: "Current State", "Development" and the rule map.
7. **Skills.**
   - Update any skill whose steps changed.
   - If this change repeated a workflow you have done before, write a new skill in `ai/skills/<gerund-name>/SKILL.md` with `name` and `description` frontmatter.
8. **Sync and verify.**
   - Run `pnpm sync:ai`, then `pnpm check`, and fix anything they report.
   - If you touched the adapter, planner, renderer or the metadata layer, also run the integration tests (`pnpm db:start`, then `pnpm test`).
   - If you touched dashboard pages or actions, click through the changed flow with the `walking-through-the-dashboard` skill.

## Done when

`pnpm check` passes, and every statement in the docs you touched is true for the code as it is now.
