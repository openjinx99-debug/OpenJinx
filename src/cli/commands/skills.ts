import { Command } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomeDir } from "../../infra/home-dir.js";
import { getEligibilityReasons } from "../../skills/eligibility.js";
import { loadSkillEntries } from "../../skills/loader.js";

/**
 * Resolve candidate paths for bundled skills.
 * In dev:       import.meta.url → src/cli/commands/skills.ts → walk up 3 levels → jinx/skills/
 * In built/npm: import.meta.url → dist/skills-*.js            → walk up 1 level  → jinx/skills/
 * Returns multiple candidates; the loader gracefully skips non-existent dirs.
 */
function bundledSkillsCandidates(): string[] {
  const thisFile = fileURLToPath(import.meta.url);
  const candidates: string[] = [];
  let dir = path.dirname(thisFile);
  // Walk up at most 3 levels (handles src/cli/commands/ in dev and dist/ in built)
  for (let i = 0; i < 3; i++) {
    dir = path.dirname(dir);
    candidates.push(path.join(dir, "skills"));
  }
  return candidates;
}

export const skillsCommand = new Command("skills").description("Skills management").addCommand(
  new Command("list").description("List available skills").action(async () => {
    const homeDir = resolveHomeDir();
    const dirs = [path.join(homeDir, "skills"), ...bundledSkillsCandidates()];

    const entries = await loadSkillEntries(dirs);

    if (entries.length === 0) {
      console.log("No skills found.");
      return;
    }

    console.log(`Found ${entries.length} skill(s):\n`);
    for (const entry of entries) {
      const reasons = getEligibilityReasons(entry);
      const status = reasons.eligible ? "ready" : "unavailable";
      const cmds = entry.commands.map((c) => `/${c.name}`).join(", ");
      console.log(`  ${entry.name}${cmds ? ` (${cmds})` : ""} [${status}]`);
      if (entry.description) {
        console.log(`    ${entry.description}`);
      }
      if (!reasons.eligible) {
        const parts: string[] = [];
        if (reasons.wrongOs) {
          parts.push(`unsupported OS (requires ${entry.os?.join(", ")})`);
        }
        if (reasons.missingBins.length > 0) {
          parts.push(`missing: ${reasons.missingBins.join(", ")}`);
        }
        if (reasons.missingEnvVars.length > 0) {
          parts.push(`missing env: ${reasons.missingEnvVars.join(", ")}`);
        }
        console.log(`    ${parts.join("; ")}`);
        if (entry.install && !reasons.wrongOs) {
          console.log(`    install: ${entry.install}`);
        }
      }
    }
  }),
);
