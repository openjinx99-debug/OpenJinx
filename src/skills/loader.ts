import fs from "node:fs/promises";
import path from "node:path";
import type { SkillEntry } from "../types/skills.js";
import { expandTilde } from "../infra/home-dir.js";
import { createLogger } from "../infra/logger.js";
import { checkSkillEligibility } from "./eligibility.js";
import { parseSkillFrontmatter } from "./parser.js";

const logger = createLogger("skills");

/**
 * Load all skill entries from the given directories.
 */
export async function loadSkillEntries(dirs: string[]): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];

  for (const dir of dirs) {
    const expandedDir = expandTilde(dir);
    try {
      const entries = await fs.readdir(expandedDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillMdPath = path.join(expandedDir, entry.name, "SKILL.md");
        try {
          const content = await fs.readFile(skillMdPath, "utf-8");
          const frontmatter = parseSkillFrontmatter(content);
          const eligible = checkSkillEligibility(frontmatter);

          skills.push({
            name: entry.name,
            displayName: frontmatter.displayName ?? entry.name,
            description: frontmatter.description ?? "",
            path: skillMdPath,
            content,
            commands: frontmatter.commands ?? [],
            os: frontmatter.os,
            requiredBins: frontmatter.requiredBins,
            requiredEnvVars: frontmatter.requiredEnvVars,
            eligible,
            envOverrides: frontmatter.envOverrides,
            tags: frontmatter.tags,
            install: frontmatter.install,
            allowedTools: frontmatter.allowedTools,
            context: frontmatter.context,
            agent: frontmatter.agent,
            argumentHint: frontmatter.argumentHint,
          });
        } catch {
          // No SKILL.md in this directory, skip
        }
      }
    } catch {
      logger.debug(`Skills directory not found: ${expandedDir}`);
    }
  }

  logger.info(
    `Loaded ${skills.length} skills (${skills.filter((s) => s.eligible).length} eligible)`,
  );
  return skills;
}
