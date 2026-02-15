import fs from "node:fs/promises";
import path from "node:path";
import type { SkillEntry, SkillCommandSpec } from "../types/skills.js";

/**
 * Create a test SkillEntry with sensible defaults.
 */
export function createTestSkillEntry(overrides?: Partial<SkillEntry>): SkillEntry {
  return {
    name: "test-skill",
    displayName: "Test Skill",
    description: "A skill for testing purposes",
    path: "/tmp/skills/test-skill/SKILL.md",
    content: "# Test Skill\n\nDo the test thing.\n",
    commands: [
      {
        name: "test",
        description: "Run the test command",
        argsRequired: false,
        executionPath: "prompt",
      },
    ],
    eligible: true,
    ...overrides,
  };
}

/**
 * Create a test SkillCommandSpec.
 */
export function createTestCommand(overrides?: Partial<SkillCommandSpec>): SkillCommandSpec {
  return {
    name: "test",
    description: "A test command",
    argsRequired: false,
    executionPath: "prompt",
    ...overrides,
  };
}

/**
 * Write a SKILL.md file to a temporary directory for testing.
 */
export async function writeTestSkillMd(
  dir: string,
  name: string,
  frontmatter: Record<string, string>,
  body: string,
): Promise<string> {
  const skillDir = path.join(dir, name);
  await fs.mkdir(skillDir, { recursive: true });

  const yamlLines = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const content = `---\n${yamlLines}\n---\n\n${body}\n`;
  const filePath = path.join(skillDir, "SKILL.md");
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}
