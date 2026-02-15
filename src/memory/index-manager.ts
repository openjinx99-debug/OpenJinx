import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { expandTilde } from "../infra/home-dir.js";
import { createLogger } from "../infra/logger.js";
import { chunkMarkdown, type Chunk } from "./chunker.js";

const logger = createLogger("memory-index");

export interface IndexedFile {
  path: string;
  hash: string;
  chunks: Chunk[];
}

/**
 * Discover markdown files in the memory directory.
 */
export async function discoverMemoryFiles(memoryDir: string): Promise<string[]> {
  const dir = expandTilde(memoryDir);
  try {
    const entries = await fs.readdir(dir, { recursive: true });
    return entries.filter((e) => e.endsWith(".md")).map((e) => path.join(dir, e));
  } catch {
    return [];
  }
}

/**
 * Hash a file's content for change detection.
 */
export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Index a single file: read, hash, chunk.
 */
export async function indexFile(filePath: string): Promise<IndexedFile> {
  const content = await fs.readFile(filePath, "utf-8");
  const hash = hashContent(content);
  const chunks = chunkMarkdown(content);

  logger.debug(`Indexed ${filePath}: ${chunks.length} chunks`);

  return { path: filePath, hash, chunks };
}

/**
 * Sync engine: discover files, check for changes, re-index as needed.
 * Returns the files that were newly indexed or re-indexed.
 */
export async function syncIndex(
  memoryDir: string,
  knownHashes: Map<string, string>,
): Promise<IndexedFile[]> {
  const files = await discoverMemoryFiles(memoryDir);
  const updated: IndexedFile[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const hash = hashContent(content);

      if (knownHashes.get(filePath) === hash) {
        continue; // File unchanged
      }

      const indexed = { path: filePath, hash, chunks: chunkMarkdown(content) };
      knownHashes.set(filePath, hash);
      updated.push(indexed);
    } catch (err) {
      logger.warn(`Failed to index ${filePath}: ${err}`);
    }
  }

  if (updated.length > 0) {
    logger.info(`Synced ${updated.length} files`);
  }

  return updated;
}
