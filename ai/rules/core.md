# Rules: packages/core

Read before changing anything in `packages/core/`. These rules add to AGENTS.md and never relax it.

## Purity

- No I/O, clock, randomness or environment access. Functions take values and return values.
- Import only core's own modules (relative paths): no `node:` builtins, no npm packages, no other workspace packages. `src/boundaries.test.ts` enforces this.
- Use a platform global only when unavoidable. Checksums use `globalThis.crypto.subtle` (Web Crypto), so core runs in Node, browsers and edge runtimes alike.
- No edition, entitlement, license-key, billing or quota logic. That belongs to the app layer (see `ai/knowledges/business-model.md`).

## Determinism

- Sort with `compareNames` (UTF-16 code units). Never use `localeCompare` or `Intl.Collator`: their results differ between machines.
- Output must not depend on input order. Canonicalize first, then work on canonical data.
- Planner output is ordered by phase, then by (namespace, table, name). Keep it that way.

## Snapshot format

- `SNAPSHOT_FORMAT_VERSION` is 1. Changing the shape of any snapshot type (adding, removing, renaming or retyping a field) requires all of the following:
  - a new format version
  - a way to read v1 documents
  - an update to `ai/knowledges/snapshot-format.md`
  - a decision entry in `ai/knowledges/decisions.md`
- Never change how an existing version is canonicalized or serialized. The golden test in `canonical.test.ts` pins v1; if it fails, you changed the format.
- Engine SQL fragments (types, defaults, expressions, index definitions) are stored verbatim. Core does not parse or rewrite them.

## Planner

- Every new `Operation` kind needs all of the following:
  - a risk level and warnings
  - an execution phase in `Phase` that respects dependencies
  - rendering in every database adapter
  - tests: order, risk, and a round trip in the adapter's integration tests
- Risk levels:
  - `destructive`: data can be lost.
  - `caution`: the operation can fail on existing data or take heavy locks.
  - `safe`: everything else.

  When unsure, choose the higher level.
- Put differences the planner cannot express in `unsupported`, with a reason. Never skip them silently.
- Match objects by name. Do not guess renames.

## Tests

- Domain logic needs unit tests, including failure cases such as invalid snapshots and unsupported changes.
