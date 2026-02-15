import { describe, expect, it } from "vitest";
import type { SkillEntry } from "../types/skills.js";
import { resolveSlashCommand, sanitizeCommandName, listAvailableCommands } from "./commands.js";

const skills: SkillEntry[] = [
  {
    name: "web-search",
    displayName: "Web Search",
    description: "Search the web",
    path: "/skills/web-search/SKILL.md",
    content: "",
    commands: [
      {
        name: "search",
        description: "Search the web",
        argsRequired: true,
        executionPath: "prompt",
      },
    ],
    eligible: true,
  },
  {
    name: "github",
    displayName: "GitHub",
    description: "GitHub integration",
    path: "/skills/github/SKILL.md",
    content: "",
    commands: [
      { name: "pr", description: "Create a PR", argsRequired: false, executionPath: "slash" },
    ],
    eligible: false, // Not eligible
  },
];

describe("resolveSlashCommand", () => {
  it("resolves an eligible command", () => {
    const result = resolveSlashCommand("search", skills);
    expect(result).toBeDefined();
    expect(result!.skill.name).toBe("web-search");
    expect(result!.command.name).toBe("search");
  });

  it("skips ineligible skills", () => {
    const result = resolveSlashCommand("pr", skills);
    expect(result).toBeUndefined();
  });

  it("returns undefined for unknown commands", () => {
    const result = resolveSlashCommand("unknown", skills);
    expect(result).toBeUndefined();
  });
});

describe("listAvailableCommands", () => {
  it("lists commands from eligible skills", () => {
    const result = listAvailableCommands(skills);
    expect(result).toHaveLength(1);
    expect(result[0].skill.name).toBe("web-search");
    expect(result[0].command.name).toBe("search");
  });

  it("deduplicates command names", () => {
    const dupeSkills: SkillEntry[] = [
      {
        name: "skill-a",
        displayName: "Skill A",
        description: "First skill",
        path: "/skills/a/SKILL.md",
        content: "",
        commands: [
          { name: "deploy", description: "Deploy A", argsRequired: false, executionPath: "slash" },
        ],
        eligible: true,
      },
      {
        name: "skill-b",
        displayName: "Skill B",
        description: "Second skill",
        path: "/skills/b/SKILL.md",
        content: "",
        commands: [
          { name: "deploy", description: "Deploy B", argsRequired: false, executionPath: "slash" },
        ],
        eligible: true,
      },
    ];

    const result = listAvailableCommands(dupeSkills);
    expect(result).toHaveLength(1);
    expect(result[0].skill.name).toBe("skill-a"); // First one wins
  });

  it("returns empty for no eligible skills", () => {
    const ineligible: SkillEntry[] = [
      {
        name: "blocked",
        displayName: "Blocked",
        description: "Not eligible",
        path: "/skills/blocked/SKILL.md",
        content: "",
        commands: [
          { name: "run", description: "Run", argsRequired: false, executionPath: "slash" },
        ],
        eligible: false,
      },
    ];

    const result = listAvailableCommands(ineligible);
    expect(result).toHaveLength(0);
  });
});

describe("sanitizeCommandName", () => {
  it("normalizes command names", () => {
    expect(sanitizeCommandName("/Search")).toBe("search");
    expect(sanitizeCommandName("web search")).toBe("web-search");
    expect(sanitizeCommandName("CAPS_NAME!")).toBe("caps-name");
  });
});
