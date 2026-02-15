/** A search result from the memory system. */
export interface MemorySearchResult {
  /** Relative file path within the memory directory. */
  filePath: string;
  /** The matched text chunk. */
  chunk: string;
  /** Start line number in the source file. */
  startLine: number;
  /** End line number in the source file. */
  endLine: number;
  /** Combined similarity score (0-1). */
  score: number;
  /** Vector similarity score component. */
  vectorScore: number;
  /** BM25 text score component. */
  textScore: number;
}

/** Configuration for a memory search query. */
export interface MemorySearchConfig {
  /** The search query text. */
  query: string;
  /** Max results to return. */
  maxResults?: number;
  /** Filter to specific file paths (glob patterns). */
  pathFilter?: string[];
  /** Minimum score threshold (0-1). */
  minScore?: number;
}

/** Metadata about the memory index state. */
export interface MemoryIndexStatus {
  /** Total files indexed. */
  totalFiles: number;
  /** Total chunks stored. */
  totalChunks: number;
  /** Whether the index is currently syncing. */
  syncing: boolean;
  /** Timestamp of last sync. */
  lastSyncAt?: number;
  /** Number of files pending re-index. */
  pendingFiles: number;
}
