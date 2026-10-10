// Copies ai/skills (the source of truth) to the folders AI tools read skills from.
//   node scripts/sync-ai.ts           update the copies
//   node scripts/sync-ai.ts --check   exit 1 if a copy differs from ai/skills
import { cp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

export const SKILLS_SOURCE = "ai/skills";
export const SKILL_COPIES = [".claude/skills", ".codex/skills"];

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Describes every difference between ai/skills and its copies; empty when in sync. */
export async function findSkillDrift(root: string): Promise<string[]> {
  const source = join(root, SKILLS_SOURCE);
  const sourceFiles = await listFiles(source);
  const problems: string[] = [];
  for (const copy of SKILL_COPIES) {
    const target = join(root, copy);
    const targetFiles = new Set(await listFiles(target));
    for (const file of sourceFiles) {
      if (!targetFiles.has(file)) {
        problems.push(`${copy}/${file} is missing`);
      } else if (
        !(await readFile(join(source, file))).equals(
          await readFile(join(target, file)),
        )
      ) {
        problems.push(`${copy}/${file} differs from ${SKILLS_SOURCE}/${file}`);
      }
      targetFiles.delete(file);
    }
    for (const extra of targetFiles)
      problems.push(`${copy}/${extra} has no source in ${SKILLS_SOURCE}`);
  }
  return problems;
}

export async function syncSkills(root: string): Promise<void> {
  for (const copy of SKILL_COPIES) {
    const target = join(root, copy);
    await rm(target, { recursive: true, force: true });
    await cp(join(root, SKILLS_SOURCE), target, { recursive: true });
  }
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..");
  if (process.argv.includes("--check")) {
    const problems = await findSkillDrift(root);
    if (problems.length > 0) {
      console.error(
        `Skill copies are out of date. Edit ${SKILLS_SOURCE}, then run pnpm sync:ai.`,
      );
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }
    console.log("Skill copies match ai/skills.");
  } else {
    await syncSkills(root);
    console.log(`Copied ${SKILLS_SOURCE} to ${SKILL_COPIES.join(" and ")}.`);
  }
}
