import type { WorkspaceFile, WorkspaceFileName } from "./loader.js";

export type SessionType = "main" | "subagent" | "group";

/** Files included per session type. */
const SESSION_FILE_SETS: Record<SessionType, Set<WorkspaceFileName>> = {
  main: new Set([
    "SOUL.md",
    "AGENTS.md",
    "IDENTITY.md",
    "USER.md",
    "TOOLS.md",
    "HEARTBEAT.md",
    "BOOTSTRAP.md",
    "MEMORY.md",
  ]),
  subagent: new Set(["SOUL.md", "AGENTS.md", "TOOLS.md", "MEMORY.md"]),
  group: new Set(["SOUL.md", "AGENTS.md", "IDENTITY.md", "USER.md", "TOOLS.md", "MEMORY.md"]),
};

/**
 * Filter workspace files based on session type.
 * Main sessions get all files. Subagents get a minimal set.
 * Group sessions exclude HEARTBEAT.md and BOOTSTRAP.md.
 */
export function filterFilesForSession(
  files: WorkspaceFile[],
  sessionType: SessionType,
): WorkspaceFile[] {
  const allowedSet = SESSION_FILE_SETS[sessionType];
  return files.filter((f) => allowedSet.has(f.name));
}
