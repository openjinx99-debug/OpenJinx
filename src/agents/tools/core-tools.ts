import fs from "node:fs/promises";
import path from "node:path";
import type { AgentToolDefinition } from "../../providers/types.js";
import { expandTilde } from "../../infra/home-dir.js";
import { createLogger } from "../../infra/logger.js";
import { detectInjectionPatterns, isPathAllowed } from "../../infra/security.js";
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from "../../infra/security.js";

const logger = createLogger("core-tools");

/** Identity files that define agent behavior — protected from background writes. */
const IDENTITY_FILES = new Set(["SOUL.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md", "HEARTBEAT.md"]);

export interface CoreToolContext {
  /** Directories the agent is allowed to read/write within. */
  allowedDirs: string[];
  /** Session type — background sessions cannot write identity files. */
  sessionType?: string;
}

/**
 * Core file-system tool definitions with real implementations.
 * All read/write operations are scoped to `ctx.allowedDirs` via `isPathAllowed()`.
 */
export function getCoreToolDefinitions(ctx: CoreToolContext): AgentToolDefinition[] {
  function assertAllowed(filePath: string): string {
    const resolved = path.resolve(expandTilde(filePath));
    if (!isPathAllowed(resolved, ctx.allowedDirs)) {
      throw new Error(
        `Path not allowed: ${filePath}. Allowed directories: ${ctx.allowedDirs.join(", ")}`,
      );
    }
    return resolved;
  }

  /** Block background/automated sessions from writing to identity files. */
  function assertNotProtected(filePath: string): void {
    const basename = path.basename(filePath);
    if (IDENTITY_FILES.has(basename) && ctx.sessionType && ctx.sessionType !== "main") {
      throw new Error(
        `Identity file ${basename} is read-only in ${ctx.sessionType} sessions. Only main (interactive) sessions can modify identity files.`,
      );
    }
  }

  /** Log a warning if content being written contains injection patterns. */
  function auditWriteContent(filePath: string, content: string): void {
    const patterns = detectInjectionPatterns(content);
    if (patterns.length > 0) {
      logger.warn(`Injection patterns in write to ${filePath}: ${patterns.join(", ")}`);
    }
  }

  return [
    {
      name: "read",
      description: "Read file contents from the filesystem",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file to read" },
        },
        required: ["path"],
      },
      execute: async (input) => {
        const { path: filePath } = input as { path: string };
        const resolved = assertAllowed(filePath);
        const content = await fs.readFile(resolved, "utf-8");
        return content;
      },
    },
    {
      name: "write",
      description: "Write content to a file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
      execute: async (input) => {
        const { path: filePath, content } = input as { path: string; content: string };
        const resolved = assertAllowed(filePath);
        assertNotProtected(resolved);
        auditWriteContent(resolved, content);
        await fs.mkdir(path.dirname(resolved), { recursive: true, mode: SECURE_DIR_MODE });
        await fs.writeFile(resolved, content, { mode: SECURE_FILE_MODE });
        return { written: true, path: resolved };
      },
    },
    {
      name: "edit",
      description: "Edit an existing file with search and replace",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file" },
          old_text: { type: "string", description: "Text to find" },
          new_text: { type: "string", description: "Replacement text" },
        },
        required: ["path", "old_text", "new_text"],
      },
      execute: async (input) => {
        const {
          path: filePath,
          old_text,
          new_text,
        } = input as {
          path: string;
          old_text: string;
          new_text: string;
        };
        const resolved = assertAllowed(filePath);
        assertNotProtected(resolved);
        auditWriteContent(resolved, new_text);
        const content = await fs.readFile(resolved, "utf-8");

        // Count occurrences to ensure uniqueness
        const occurrences = content.split(old_text).length - 1;
        if (occurrences === 0) {
          throw new Error(`old_text not found in ${filePath}`);
        }
        if (occurrences > 1) {
          throw new Error(
            `old_text found ${occurrences} times in ${filePath} — must be unique (found ${occurrences})`,
          );
        }

        const updated = content.replace(old_text, new_text);
        await fs.writeFile(resolved, updated, { mode: SECURE_FILE_MODE });
        return { edited: true, path: resolved };
      },
    },
    {
      name: "glob",
      description: "Find files matching a glob pattern",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. **/*.md)" },
          path: { type: "string", description: "Directory to search in" },
        },
        required: ["pattern"],
      },
      execute: async (input) => {
        const { pattern, path: searchPath } = input as { pattern: string; path?: string };
        const baseDir = searchPath ? assertAllowed(searchPath) : ctx.allowedDirs[0];
        if (!isPathAllowed(baseDir, ctx.allowedDirs)) {
          throw new Error(`Path not allowed: ${baseDir}`);
        }

        // Read all files recursively, then filter by pattern
        const entries = await fs.readdir(baseDir, { recursive: true, withFileTypes: true });
        const files: string[] = [];
        const globRe = globToRegExp(pattern);

        for (const entry of entries) {
          if (!entry.isFile()) {
            continue;
          }
          const parentPath = entry.parentPath ?? (entry as { path?: string }).path ?? baseDir;
          const relativePath = path.relative(baseDir, path.join(parentPath, entry.name));
          if (globRe.test(relativePath)) {
            files.push(relativePath);
          }
        }

        return { baseDir, files: files.toSorted() };
      },
    },
    {
      name: "grep",
      description: "Search file contents with regex",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "File or directory to search" },
          glob: { type: "string", description: "Glob filter for files (e.g. *.md)" },
        },
        required: ["pattern"],
      },
      execute: async (input) => {
        const {
          pattern: regexStr,
          path: searchPath,
          glob: globFilter,
        } = input as { pattern: string; path?: string; glob?: string };

        const baseDir = searchPath ? assertAllowed(searchPath) : ctx.allowedDirs[0];
        if (!isPathAllowed(baseDir, ctx.allowedDirs)) {
          throw new Error(`Path not allowed: ${baseDir}`);
        }

        const regex = new RegExp(regexStr, "gi");

        // Collect files to search
        const stat = await fs.stat(baseDir);
        let filePaths: string[];
        if (stat.isFile()) {
          filePaths = [baseDir];
        } else {
          const entries = await fs.readdir(baseDir, { recursive: true, withFileTypes: true });
          const globRe = globFilter ? globToRegExp(globFilter) : null;
          filePaths = [];
          for (const entry of entries) {
            if (!entry.isFile()) {
              continue;
            }
            const parentPath = entry.parentPath ?? (entry as { path?: string }).path ?? baseDir;
            const fullPath = path.join(parentPath, entry.name);
            const relativePath = path.relative(baseDir, fullPath);
            if (globRe && !globRe.test(relativePath)) {
              continue;
            }
            filePaths.push(fullPath);
          }
        }

        const matches: { file: string; line: number; text: string }[] = [];
        const MAX_MATCHES = 100;

        for (const filePath of filePaths) {
          if (matches.length >= MAX_MATCHES) {
            break;
          }
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              regex.lastIndex = 0;
              if (regex.test(lines[i])) {
                matches.push({
                  file: path.relative(baseDir, filePath),
                  line: i + 1,
                  text: lines[i],
                });
                if (matches.length >= MAX_MATCHES) {
                  break;
                }
              }
            }
          } catch {
            // Skip files that can't be read (binary, permissions, etc.)
          }
        }

        return { baseDir, matches };
      },
    },
  ];
}

/** Convert a simple glob pattern to a RegExp. Supports * and ** wildcards. */
function globToRegExp(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      // ** matches any path segments
      re += ".*";
      i += 2;
      if (pattern[i] === "/") {
        i++;
      } // skip trailing slash
    } else if (ch === "*") {
      // * matches anything except path separator
      re += "[^/]*";
      i++;
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
      i++;
    } else {
      re += ch;
      i++;
    }
  }
  return new RegExp("^" + re + "$");
}
