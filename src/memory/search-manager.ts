import type { MemoryConfig } from "../types/config.js";
import type { MemorySearchResult, MemorySearchConfig, MemoryIndexStatus } from "../types/memory.js";
import type { EmbeddingProvider } from "./embeddings.js";
import { createLogger } from "../infra/logger.js";
import { hybridSearch, type SearchIndex, type IndexedChunk } from "./hybrid-search.js";
import { syncIndex, type IndexedFile } from "./index-manager.js";
import { loadIndex, saveIndex } from "./persistence.js";

const logger = createLogger("memory-search");

export class MemorySearchManager {
  private index: SearchIndex = { chunks: [] };
  private knownHashes = new Map<string, string>();
  private syncing = false;
  private lastSyncAt?: number;
  private dirty = false;

  constructor(
    private config: MemoryConfig,
    private embeddings?: EmbeddingProvider,
  ) {}

  /**
   * Initialize the search manager by loading a persisted index from disk.
   * Call this once at startup before the first sync().
   */
  async init(): Promise<void> {
    const persisted = await loadIndex(this.config.dir);
    if (persisted) {
      this.index = persisted.index;
      this.knownHashes = persisted.knownHashes;
      logger.info(
        `Restored index: ${this.index.chunks.length} chunks, ${this.knownHashes.size} files`,
      );
    }
  }

  /** Sync the index by discovering and re-indexing changed files. */
  async sync(): Promise<void> {
    if (this.syncing) {
      return;
    }
    this.syncing = true;

    try {
      const updated = await syncIndex(this.config.dir, this.knownHashes);
      if (updated.length > 0) {
        await this.applyUpdates(updated);
        this.dirty = true;
      }

      // Persist to disk if anything changed
      if (this.dirty) {
        await saveIndex(this.config.dir, this.index, this.knownHashes);
        this.dirty = false;
      }

      this.lastSyncAt = Date.now();
    } finally {
      this.syncing = false;
    }
  }

  /** Search the memory index. Auto-syncs if needed. */
  async search(query: MemorySearchConfig): Promise<MemorySearchResult[]> {
    // Dirty check — sync if we haven't recently
    if (!this.lastSyncAt || Date.now() - this.lastSyncAt > 30_000) {
      await this.sync();
    }

    let queryEmbedding: number[] | undefined;
    if (this.embeddings) {
      try {
        [queryEmbedding] = await this.embeddings.embed([query.query]);
      } catch (err) {
        logger.warn(`Failed to generate query embedding, falling back to BM25: ${err}`);
      }
    }

    const results = hybridSearch(
      query.query,
      queryEmbedding,
      this.index,
      query.maxResults ?? this.config.maxResults,
      this.config.vectorWeight,
    );

    // Apply path filter if specified
    if (query.pathFilter && query.pathFilter.length > 0) {
      return results.filter((r) =>
        query.pathFilter!.some((pattern) => r.filePath.includes(pattern)),
      );
    }

    // Apply min score filter
    if (query.minScore) {
      return results.filter((r) => r.score >= query.minScore!);
    }

    return results;
  }

  /** Get current index status. */
  getStatus(): MemoryIndexStatus {
    const fileSet = new Set(this.index.chunks.map((c) => c.filePath));
    return {
      totalFiles: fileSet.size,
      totalChunks: this.index.chunks.length,
      syncing: this.syncing,
      lastSyncAt: this.lastSyncAt,
      pendingFiles: 0,
    };
  }

  private async applyUpdates(updated: IndexedFile[]): Promise<void> {
    // Remove old chunks for updated files
    const updatedPaths = new Set(updated.map((f) => f.path));
    const kept = this.index.chunks.filter((c) => !updatedPaths.has(c.filePath));

    // Add new chunks
    const newChunks: IndexedChunk[] = updated.flatMap((f) =>
      f.chunks.map((c) => ({
        filePath: f.path,
        content: c.content,
        startLine: c.startLine,
        endLine: c.endLine,
      })),
    );

    // Generate embeddings for new chunks
    if (this.embeddings && newChunks.length > 0) {
      try {
        const texts = newChunks.map((c) => c.content);
        const vectors = await this.embeddings.embed(texts);
        for (let i = 0; i < newChunks.length; i++) {
          newChunks[i].embedding = vectors[i];
        }
      } catch (err) {
        logger.warn(`Failed to generate chunk embeddings, chunks stored without vectors: ${err}`);
      }
    }

    this.index.chunks = [...kept, ...newChunks];
    logger.debug(`Index updated: ${this.index.chunks.length} total chunks`);
  }
}
