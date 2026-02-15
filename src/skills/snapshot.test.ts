import { describe, expect, it } from "vitest";
import type { SkillEntry } from "../types/skills.js";
import { buildSkillSnapshot } from "./snapshot.js";

function makeSkill(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    name: "test-skill",
    displayName: "Test Skill",
    description: "A test skill",
    path: "/skills/test-skill/SKILL.md",
    content: "# Test Skill\nDoes things.",
    commands: [],
    eligible: true,
    ...overrides,
  };
}

describe("buildSkillSnapshot", () => {
  it("returns empty snapshot when no skills are provided", () => {
    const result = buildSkillSnapshot([]);
    expect(result).toEqual({ prompt: "", count: 0, names: [], version: "" });
  });

  it("returns empty snapshot when all skills are ineligible", () => {
    const skills = [
      makeSkill({ eligible: false }),
      makeSkill({ name: "another", eligible: false }),
    ];
    const result = buildSkillSnapshot(skills);
    expect(result.count).toBe(0);
    expect(result.prompt).toBe("");
    expect(result.names).toEqual([]);
    expect(result.version).toBe("");
  });

  it("builds snapshot with eligible skills only", () => {
    const skills = [
      makeSkill({ name: "github", description: "GitHub integration", eligible: true }),
      makeSkill({ name: "slack", description: "Slack integration", eligible: false }),
    ];

    const result = buildSkillSnapshot(skills);

    expect(result.count).toBe(1);
    expect(result.names).toEqual(["github"]);
    expect(result.prompt).toContain("<available-skills>");
    expect(result.prompt).toContain('skill name="github"');
    expect(result.prompt).toContain("GitHub integration");
    expect(result.prompt).not.toContain("slack");
  });

  it("includes commands in the XML output", () => {
    const skills = [
      makeSkill({
        name: "github",
        commands: [
          {
            name: "search",
            description: "Search GitHub repos",
            argsRequired: true,
            executionPath: "prompt",
          },
          {
            name: "pr",
            description: "Create a PR",
            argsRequired: false,
            executionPath: "slash",
          },
        ],
      }),
    ];

    const result = buildSkillSnapshot(skills);

    expect(result.prompt).toContain("<commands>");
    expect(result.prompt).toContain("- /search: Search GitHub repos");
    expect(result.prompt).toContain("- /pr: Create a PR");
    expect(result.prompt).toContain("</commands>");
  });

  it("omits commands section when skill has no commands", () => {
    const skills = [makeSkill({ name: "simple", commands: [] })];
    const result = buildSkillSnapshot(skills);

    expect(result.prompt).not.toContain("<commands>");
    expect(result.prompt).not.toContain("</commands>");
  });

  it("generates a stable version hash from skill names", () => {
    const skills = [makeSkill({ name: "alpha" }), makeSkill({ name: "beta" })];

    const result1 = buildSkillSnapshot(skills);
    const result2 = buildSkillSnapshot(skills);

    expect(result1.version).toBe(result2.version);
    expect(result1.version).toHaveLength(8);
  });

  it("produces different version hashes for different skill sets", () => {
    const set1 = [makeSkill({ name: "alpha" })];
    const set2 = [makeSkill({ name: "beta" })];

    const result1 = buildSkillSnapshot(set1);
    const result2 = buildSkillSnapshot(set2);

    expect(result1.version).not.toBe(result2.version);
  });

  it("includes the skill path in the output", () => {
    const skills = [makeSkill({ name: "notes", path: "/skills/apple-notes/SKILL.md" })];
    const result = buildSkillSnapshot(skills);
    expect(result.prompt).toContain("<path>/skills/apple-notes/SKILL.md</path>");
  });
});
