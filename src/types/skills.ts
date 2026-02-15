/** Parsed skill entry from a SKILL.md file. */
export interface SkillEntry {
  /** Unique skill name (derived from directory name). */
  name: string;
  /** Display name from frontmatter. */
  displayName: string;
  /** Short description from frontmatter. */
  description: string;
  /** Path to the SKILL.md file. */
  path: string;
  /** Full markdown content of SKILL.md. */
  content: string;
  /** Slash commands this skill provides. */
  commands: SkillCommandSpec[];
  /** OS restrictions (e.g., ["macos", "linux"]). */
  os?: string[];
  /** Required binaries that must be on PATH. */
  requiredBins?: string[];
  /** Required environment variables. */
  requiredEnvVars?: string[];
  /** Whether this skill is eligible on the current system. */
  eligible: boolean;
  /** Env var overrides to inject at runtime. */
  envOverrides?: Record<string, string>;
  /** Tags for categorization. */
  tags?: string[];
  /** Install instructions for missing required binaries. */
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

/** A slash command provided by a skill. */
export interface SkillCommandSpec {
  /** Command name (e.g., "search"). */
  name: string;
  /** Command description. */
  description: string;
  /** Whether arguments are required. */
  argsRequired: boolean;
  /** Argument placeholder text. */
  argsPlaceholder?: string;
  /** Execution path: prompt-based, slash-rewrite, or direct dispatch. */
  executionPath: "prompt" | "slash" | "direct";
}

/** Snapshot of skills for inclusion in the system prompt. */
export interface SkillSnapshot {
  /** XML-formatted skill entries for the system prompt. */
  prompt: string;
  /** Number of skills included. */
  count: number;
  /** Skill names included. */
  names: string[];
  /** Version hash for change detection. */
  version: string;
}
