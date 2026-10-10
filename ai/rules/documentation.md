# Rules: documentation for every change

Every change is documented in the same change. `pnpm check` runs `scripts/check-docs.ts`, which enforces items 1 and 7. The other items are your responsibility. The `documenting-changes` skill walks through them.

## Checklist

1. **CHANGELOG.md**
   - Every change to source, scripts or configuration gets an entry under `## [Unreleased]`.
   - Use the Keep a Changelog sections: Added, Changed, Deprecated, Removed, Fixed, Security.
   - Write for users: what they can now do, or what behaves differently.
2. **Knowledges (`ai/knowledges/`)**: update every page the change makes inaccurate:
   - `architecture.md` for packages and data flow
   - `snapshot-format.md` for format changes
   - `postgresql-support.md` for object support and planner behavior
   - `glossary.md` for new terms
3. **Decisions**
   - When you choose between real alternatives (a dependency, a format, a boundary, a policy), append a dated entry to `ai/knowledges/decisions.md`.
   - Never rewrite an old entry. Supersede it with a new one.
4. **Gotchas**: when something surprised you or cost time, add it and its fix to `ai/knowledges/gotchas.md`.
5. **Rules**
   - When a convention changes, update the matching file in `ai/rules/`.
   - For repository-wide facts, update AGENTS.md. Keep its "Current State" and "Development" sections true.
6. **Skills (`ai/skills/`)**
   - Update a skill when its workflow changes.
   - The second time you carry out a multi-step workflow, write a skill for it. Use a gerund-style name and `name`/`description` frontmatter.
7. **Skill copies**: edit skills only in `ai/skills/`, then run `pnpm sync:ai`. Never edit `.claude/skills` or `.codex/skills` directly; they are generated copies.

## Style

- Write for the next reader, a developer or an AI agent, who has none of your context.
- State limitations and unsupported behavior explicitly.
- Keep pages short and factual. Point to code instead of copying it.
- Never put secrets, passwords, connection strings with credentials, or customer data in docs, examples or tests.
