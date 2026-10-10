// Documentation gate, run by `pnpm check`. Fails when:
//   - a skill copy (.claude/skills, .codex/skills) differs from ai/skills, or
//   - source or config files changed since HEAD without a CHANGELOG.md change.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findSkillDrift } from "./sync-ai.ts";

const ROOT_CONFIG = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  ".env.example",
]);

/** Whether a change to this repository path must be recorded in CHANGELOG.md. */
export function requiresChangelog(path: string): boolean {
  if (
    path.endsWith(".md") ||
    path.endsWith(".test.ts") ||
    path.includes("/fixtures/")
  )
    return false;
  if (ROOT_CONFIG.has(path)) return true;
  if (/^packages\/[^/]+\/package\.json$/.test(path)) return true;
  return /^(packages\/[^/]+\/(src|examples)|apps\/[^/]+\/src|scripts)\//.test(
    path,
  );
}

/** Changed paths that need a changelog entry, or none if CHANGELOG.md itself changed. */
export function missingChangelog(changedPaths: readonly string[]): string[] {
  if (changedPaths.includes("CHANGELOG.md")) return [];
  return changedPaths.filter(requiresChangelog);
}

/** Parses `git status --porcelain=v1 -z`: tracked changes against HEAD plus untracked files. */
export function parsePorcelain(output: string): string[] {
  const paths: string[] = [];
  const records = output.split("\0");
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    if (record.length < 4) continue;
    paths.push(record.slice(3));
    // A rename or copy is followed by a second record holding the original path.
    if (record[0] === "R" || record[0] === "C") i += 1;
  }
  return paths;
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..");
  const problems = (await findSkillDrift(root)).map(
    (problem) => `${problem} (edit ai/skills, then run pnpm sync:ai)`,
  );
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  const undocumented = missingChangelog(parsePorcelain(status));
  if (undocumented.length > 0) {
    problems.push(
      `These changes need an entry under [Unreleased] in CHANGELOG.md: ${undocumented.join(", ")}`,
    );
  }
  if (problems.length > 0) {
    console.error("Documentation check failed. See ai/rules/documentation.md.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("Documentation check passed.");
}
