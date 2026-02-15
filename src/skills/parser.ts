import { parse as parseYaml } from "yaml";
import type { SkillCommandSpec } from "../types/skills.js";

export interface ParsedSkillFrontmatter {
  name?: string;
  displayName?: string;
  description?: string;
  commands?: SkillCommandSpec[];
  os?: string[];
  requiredBins?: string[];
  requiredEnvVars?: string[];
  envOverrides?: Record<string, string>;
  tags?: string[];
  install?: string;
  /** Tool names this skill is allowed to use. */
  allowedTools?: string[];
  /** Additional context file paths to include. */
  context?: string[];
  /** Target agent override. */
  agent?: string;
  /** Hint text for parameterized skill usage. */
  argumentHint?: string;
}

/** Coerce a value to a string array (handles YAML arrays and comma-separated strings). */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Parse SKILL.md frontmatter (YAML between --- delimiters).
 * Uses the `yaml` package for full YAML support (arrays, booleans, nested objects).
 * Backward-compatible: flat `key: value` fields still work as before.
 */
export function parseSkillFrontmatter(content: string): ParsedSkillFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  const raw = match[1];
  if (!raw.trim()) {
    return {};
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(raw) as Record<string, unknown>;
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const result: ParsedSkillFrontmatter = {};

  if (typeof parsed.name === "string") {
    result.name = parsed.name;
  }
  if (typeof parsed.display_name === "string") {
    result.displayName = parsed.display_name;
  }
  if (typeof parsed.description === "string") {
    result.description = parsed.description;
  }
  if (typeof parsed.install === "string") {
    result.install = parsed.install;
  }
  if (typeof parsed.agent === "string") {
    result.agent = parsed.agent;
  }
  if (typeof parsed.argument_hint === "string") {
    result.argumentHint = parsed.argument_hint;
  }

  if (parsed.os !== undefined) {
    result.os = toStringArray(parsed.os);
  }
  if (parsed.required_bins !== undefined) {
    result.requiredBins = toStringArray(parsed.required_bins);
  }
  if (parsed.required_env !== undefined) {
    result.requiredEnvVars = toStringArray(parsed.required_env);
  }
  if (parsed.tags !== undefined) {
    result.tags = toStringArray(parsed.tags);
  }
  if (parsed.allowed_tools !== undefined) {
    result.allowedTools = toStringArray(parsed.allowed_tools);
  }
  if (parsed.context !== undefined) {
    result.context = toStringArray(parsed.context);
  }

  return result;
}

/**
 * Extract the body content (everything after the frontmatter closing ---).
 */
export function extractSkillBody(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1] : content;
}

/**
 * Substitute $ARGUMENTS and $0 placeholders in skill body text.
 * $ARGUMENTS and $0 are replaced with the full argument string.
 */
export function substituteArguments(body: string, args: string): string {
  return body.replaceAll("$ARGUMENTS", args).replaceAll("$0", args);
}
