import fs from "node:fs/promises";
import path from "node:path";
import { expandTilde } from "../infra/home-dir.js";
import { createLogger } from "../infra/logger.js";
import { LIMITS, truncateToLimit } from "../infra/security.js";

const logger = createLogger("workspace");

/** The standard workspace file names in load order. */
export const WORKSPACE_FILES = [
  "SOUL.md",
  "AGENTS.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
] as const;

export type WorkspaceFileName = (typeof WORKSPACE_FILES)[number];

/** A loaded workspace file. */
export interface WorkspaceFile {
  name: WorkspaceFileName;
  path: string;
  content: string;
  missing: boolean;
}

/**
 * Load all workspace files from the given directory.
 * Missing files are returned with `missing: true` and empty content.
 */
export async function loadWorkspaceFiles(workspaceDir: string): Promise<WorkspaceFile[]> {
  const dir = expandTilde(workspaceDir);
  const files: WorkspaceFile[] = [];

  for (const name of WORKSPACE_FILES) {
    const filePath = path.join(dir, name);
    try {
      let content = await fs.readFile(filePath, "utf-8");
      if (Buffer.byteLength(content, "utf-8") > LIMITS.MAX_WORKSPACE_FILE_BYTES) {
        logger.warn(
          `Workspace file ${name} exceeds ${LIMITS.MAX_WORKSPACE_FILE_BYTES} bytes, truncating`,
        );
        content = truncateToLimit(content, LIMITS.MAX_WORKSPACE_FILE_BYTES);
      }
      files.push({ name, path: filePath, content, missing: false });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        logger.warn(`Failed to read workspace file ${name}: ${code ?? err}`);
      } else {
        logger.debug(`Workspace file not found: ${name}`);
      }
      files.push({ name, path: filePath, content: "", missing: true });
    }
  }

  return files;
}
