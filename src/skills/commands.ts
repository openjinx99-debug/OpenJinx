import type { SkillEntry, SkillCommandSpec } from "../types/skills.js";

interface ResolvedCommand {
  skill: SkillEntry;
  command: SkillCommandSpec;
}

/**
 * Resolve a slash command name to its skill and command spec.
 */
export function resolveSlashCommand(
  commandName: string,
  skills: SkillEntry[],
): ResolvedCommand | undefined {
  const normalized = sanitizeCommandName(commandName);

  for (const skill of skills) {
    if (!skill.eligible) {
      continue;
    }
    for (const cmd of skill.commands) {
      if (sanitizeCommandName(cmd.name) === normalized) {
        return { skill, command: cmd };
      }
    }
  }

  return undefined;
}

/**
 * List all available slash commands from eligible skills.
 */
export function listAvailableCommands(skills: SkillEntry[]): ResolvedCommand[] {
  const commands: ResolvedCommand[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    if (!skill.eligible) {
      continue;
    }
    for (const cmd of skill.commands) {
      const key = sanitizeCommandName(cmd.name);
      if (!seen.has(key)) {
        seen.add(key);
        commands.push({ skill, command: cmd });
      }
    }
  }

  return commands;
}

/**
 * Sanitize a command name (lowercase, strip leading slash, alphanumeric + hyphens only).
 */
export function sanitizeCommandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\//, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
