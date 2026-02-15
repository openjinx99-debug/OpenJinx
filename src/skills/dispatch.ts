import type { SkillEntry, SkillCommandSpec } from "../types/skills.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("skills");

export type SkillExecutionPath = "prompt" | "slash" | "direct";

/**
 * Dispatch a skill execution based on the command's execution path.
 */
export function dispatchSkill(
  skill: SkillEntry,
  command: SkillCommandSpec,
  args: string,
): { prompt: string; executionPath: SkillExecutionPath } {
  const path = command.executionPath;

  switch (path) {
    case "prompt":
      // Agent reads the SKILL.md content and follows instructions
      return {
        prompt: `Execute the "${skill.name}" skill. Read and follow the instructions in: ${skill.path}\n\nUser request: ${args}`,
        executionPath: "prompt",
      };

    case "slash":
      // Rewrite as a prompt with the skill context
      return {
        prompt: `/${command.name} ${args}\n\n<skill-context>\n${skill.content}\n</skill-context>`,
        executionPath: "slash",
      };

    case "direct":
      // Direct tool dispatch (bypass agent)
      logger.info(`Direct dispatch: ${skill.name}/${command.name}`);
      return {
        prompt: `Execute the "${command.name}" tool directly with args: ${args}`,
        executionPath: "direct",
      };
  }
}
