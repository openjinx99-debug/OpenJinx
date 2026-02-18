import fs from "node:fs/promises";
import path from "node:path";
import type { MarathonContextConfig } from "../types/config.js";
import type { ChunkResult, MarathonCheckpoint } from "../types/marathon.js";
import type { WorkspaceSnapshot } from "./marathon-prompts.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("marathon-context");

/** Progress file name — the inter-chunk memory file. */
export const PROGRESS_FILE = "PROGRESS.md";

/**
 * Key file patterns to include in workspace snapshots.
 * Ordered by priority — PROGRESS.md first.
 */
const KEY_FILE_PATTERNS = [
  PROGRESS_FILE,
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "requirements.txt",
  "Makefile",
  "README.md",
  // Common entry points
  "src/index.ts",
  "src/index.js",
  "src/main.ts",
  "src/main.js",
  "src/app.ts",
  "src/app.js",
  "index.ts",
  "index.js",
  "main.py",
  "main.go",
  "src/main.rs",
  "src/lib.rs",
];

// ── File Tree ────────────────────────────────────────────────────────

/** Directories to skip when listing files. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "coverage",
]);

/**
 * Recursively list files in a directory, skipping noise directories.
 * Returns paths relative to the base directory.
 * @internal Exported for testing.
 */
export async function listFilesRecursive(dir: string, maxFiles = 500): Promise<string[]> {
  const results: string[] = [];
  await listFilesInner(dir, dir, results, maxFiles);
  return results;
}

async function listFilesInner(
  baseDir: string,
  currentDir: string,
  results: string[],
  maxFiles: number,
): Promise<void> {
  if (results.length >= maxFiles) {
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxFiles) {
      break;
    }

    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await listFilesInner(baseDir, full, results, maxFiles);
    } else {
      results.push(path.relative(baseDir, full));
    }
  }
}

// ── Workspace Snapshot ───────────────────────────────────────────────

/**
 * Build a workspace snapshot for fresh-context chunk prompts.
 * Includes file tree, key file contents, and PROGRESS.md.
 */
export async function buildWorkspaceSnapshot(
  workspaceDir: string,
  config: MarathonContextConfig,
): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = {
    fileTree: [],
    keyFiles: [],
  };

  if (!config.enabled) {
    return snapshot;
  }

  // 1. File tree
  const allFiles = await listFilesRecursive(workspaceDir, config.maxTreeFiles);
  snapshot.fileTree = allFiles;

  // 2. Read key files with budget tracking
  let totalChars = 0;
  const maxPerFile = config.maxFileBytes;

  for (const pattern of KEY_FILE_PATTERNS) {
    if (totalChars >= config.maxTotalChars) {
      break;
    }

    const filePath = path.join(workspaceDir, pattern);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const truncated =
        content.length > maxPerFile ? content.slice(0, maxPerFile) + "\n... (truncated)" : content;

      if (pattern === PROGRESS_FILE) {
        snapshot.progressMd = truncated;
      } else {
        snapshot.keyFiles.push({ path: pattern, content: truncated });
      }

      totalChars += truncated.length;
    } catch {
      // File doesn't exist, skip
    }
  }

  // If over budget, drop largest key files (not PROGRESS.md)
  while (totalChars > config.maxTotalChars && snapshot.keyFiles.length > 0) {
    // Find and remove the largest key file
    let maxIdx = 0;
    let maxLen = 0;
    for (let i = 0; i < snapshot.keyFiles.length; i++) {
      if (snapshot.keyFiles[i].content.length > maxLen) {
        maxLen = snapshot.keyFiles[i].content.length;
        maxIdx = i;
      }
    }
    totalChars -= snapshot.keyFiles[maxIdx].content.length;
    snapshot.keyFiles.splice(maxIdx, 1);
  }

  logger.info(
    `Workspace snapshot: ${snapshot.fileTree.length} files, ${snapshot.keyFiles.length} key files, ` +
      `PROGRESS.md: ${snapshot.progressMd ? "yes" : "no"}, ~${totalChars} chars`,
  );

  return snapshot;
}

// ── PROGRESS.md Writer ───────────────────────────────────────────────

/**
 * Write or append to PROGRESS.md after a chunk completes.
 * Creates the file if it doesn't exist, appends a new section if it does.
 */
export async function writeProgressFile(
  workspaceDir: string,
  checkpoint: MarathonCheckpoint,
  chunkResult: ChunkResult,
): Promise<void> {
  const progressPath = path.join(workspaceDir, PROGRESS_FILE);

  // Read existing content (if any)
  let existing = "";
  try {
    existing = await fs.readFile(progressPath, "utf-8");
  } catch {
    // File doesn't exist yet, start fresh
    existing = "# Marathon Progress\n";
  }

  const chunk = checkpoint.plan.chunks[checkpoint.currentChunkIndex];
  const chunkIndex = checkpoint.currentChunkIndex;
  const totalChunks = checkpoint.plan.chunks.length;

  // Extract key info from the chunk result
  const filesSection =
    chunkResult.filesWritten.length > 0
      ? `- Key files: ${chunkResult.filesWritten.slice(0, 10).join(", ")}`
      : "- No files written";

  let criteriaSection = "";
  if (chunkResult.criteriaResult) {
    const cr = chunkResult.criteriaResult;
    criteriaSection = `- Criteria: ${cr.passCount}/${cr.results.length} passed`;
    if (!cr.allPassed) {
      const failed = cr.results.filter((r) => !r.passed);
      criteriaSection += `\n  Failed: ${failed.map((f) => f.criterion).join(", ")}`;
    }
  } else if (chunkResult.testStatus) {
    criteriaSection = `- Tests: ${chunkResult.testStatus.testsPassed ? "passing" : "failing"}${chunkResult.testStatus.testCommand ? ` (${chunkResult.testStatus.testCommand})` : ""}`;
  }

  const newSection = `
## Completed: ${chunk?.name ?? chunkResult.chunkName} (chunk ${chunkIndex + 1}/${totalChunks})
- ${chunkResult.summary.slice(0, 300)}
${filesSection}
${criteriaSection}
`.trimEnd();

  const updatedContent = existing.trimEnd() + "\n" + newSection + "\n";

  await fs.writeFile(progressPath, updatedContent, "utf-8");
  logger.info(
    `Updated PROGRESS.md: chunk ${chunkIndex + 1}/${totalChunks} (${chunkResult.chunkName})`,
  );
}
