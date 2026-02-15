import fs from "node:fs/promises";
import path from "node:path";
import type { IndexedChunk, SearchIndex } from "./hybrid-search.js";
import { expandTilde } from "../infra/home-dir.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("memory-persist");

const INDEX_FILENAME = ".search-index.json";

interface PersistedIndex {
  version: 1;
  savedAt: number;
  hashes: Record<string, string>; // filePath → contentHash
  chunks: PersistedChunk[];
}

interface PersistedChunk {
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  embedding?: number[];
}

/**
 * Save the in-memory search index and file hashes to disk.
 */
export async function saveIndex(
  memoryDir: string,
  index: SearchIndex,
  knownHashes: Map<string, string>,
): Promise<void> {
  const dir = expandTilde(memoryDir);
  const filePath = path.join(dir, INDEX_FILENAME);

  const data: PersistedIndex = {
    version: 1,
    savedAt: Date.now(),
    hashes: Object.fromEntries(knownHashes),
    chunks: index.chunks.map((c) => ({
      filePath: c.filePath,
      content: c.content,
      startLine: c.startLine,
      endLine: c.endLine,
      embedding: c.embedding,
    })),
  };

  try {
    await fs.writeFile(filePath, JSON.stringify(data), { mode: 0o600 });
    logger.debug(`Saved index: ${data.chunks.length} chunks, ${knownHashes.size} files`);
  } catch (err) {
    logger.warn(`Failed to save index: ${err}`);
  }
}

/**
 * Load a previously persisted search index from disk.
 * Returns undefined if no persisted index exists or it's invalid.
 */
export async function loadIndex(
  memoryDir: string,
): Promise<{ index: SearchIndex; knownHashes: Map<string, string> } | undefined> {
  const dir = expandTilde(memoryDir);
  const filePath = path.join(dir, INDEX_FILENAME);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as PersistedIndex;

    if (data.version !== 1) {
      logger.info(`Index version mismatch (got ${data.version}), will rebuild`);
      return undefined;
    }

    const knownHashes = new Map(Object.entries(data.hashes));

    const chunks: IndexedChunk[] = data.chunks.map((c) => ({
      filePath: c.filePath,
      content: c.content,
      startLine: c.startLine,
      endLine: c.endLine,
      embedding: c.embedding,
    }));

    logger.info(
      `Loaded persisted index: ${chunks.length} chunks, ${knownHashes.size} files (saved ${new Date(data.savedAt).toISOString()})`,
    );

    return { index: { chunks }, knownHashes };
  } catch {
    // No persisted index or parse error — will rebuild from scratch
    return undefined;
  }
}
