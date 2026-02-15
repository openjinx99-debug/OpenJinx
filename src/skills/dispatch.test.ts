import { describe, expect, it } from "vitest";
import { createTestSkillEntry, createTestCommand } from "../__test__/skills.js";
import { dispatchSkill } from "./dispatch.js";

describe("dispatchSkill", () => {
  describe("prompt execution path", () => {
    it("returns a prompt referencing the skill path and user request", () => {
      const skill = createTestSkillEntry({ name: "search", path: "/skills/search/SKILL.md" });
      const command = createTestCommand({ name: "search", executionPath: "prompt" });

      const result = dispatchSkill(skill, command, "how to cook pasta");

      expect(result.executionPath).toBe("prompt");
      expect(result.prompt).toContain("/skills/search/SKILL.md");
      expect(result.prompt).toContain("how to cook pasta");
      expect(result.prompt).toContain("search");
    });
  });

  describe("slash execution path", () => {
    it("rewrites as slash command with skill context", () => {
      const skill = createTestSkillEntry({
        name: "github",
        content: "# GitHub\nDo GitHub things.\n",
      });
      const command = createTestCommand({ name: "pr", executionPath: "slash" });

      const result = dispatchSkill(skill, command, "fix auth bug");

      expect(result.executionPath).toBe("slash");
      expect(result.prompt).toContain("/pr fix auth bug");
      expect(result.prompt).toContain("<skill-context>");
      expect(result.prompt).toContain("# GitHub");
      expect(result.prompt).toContain("</skill-context>");
    });
  });

  describe("direct execution path", () => {
    it("dispatches direct tool call", () => {
      const skill = createTestSkillEntry({ name: "tool" });
      const command = createTestCommand({ name: "run", executionPath: "direct" });

      const result = dispatchSkill(skill, command, "ls -la");

      expect(result.executionPath).toBe("direct");
      expect(result.prompt).toContain("run");
      expect(result.prompt).toContain("ls -la");
    });
  });

  it("passes args to all execution paths", () => {
    const skill = createTestSkillEntry();
    const args = "complex argument with spaces";

    for (const path of ["prompt", "slash", "direct"] as const) {
      const command = createTestCommand({ name: "cmd", executionPath: path });
      const result = dispatchSkill(skill, command, args);
      expect(result.prompt).toContain(args);
    }
  });
});
