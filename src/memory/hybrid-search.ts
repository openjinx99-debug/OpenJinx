import type { MemorySearchResult } from "../types/memory.js";

export interface SearchIndex {
  /** All indexed chunks for BM25 / vector search. */
  chunks: IndexedChunk[];
}

export interface IndexedChunk {
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  embedding?: number[];
}

/**
 * Hybrid search: combine vector similarity and BM25 text search.
 * Score = vectorWeight * vectorScore + (1 - vectorWeight) * textScore
 */
export function hybridSearch(
  query: string,
  queryEmbedding: number[] | undefined,
  index: SearchIndex,
  maxResults: number,
  vectorWeight = 0.7,
): MemorySearchResult[] {
  const scored: MemorySearchResult[] = [];

  for (const chunk of index.chunks) {
    const textScore = bm25Score(query, chunk.content);
    const vectorScore =
      queryEmbedding && chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0;

    const score = vectorWeight * vectorScore + (1 - vectorWeight) * textScore;

    if (score > 0) {
      scored.push({
        filePath: chunk.filePath,
        chunk: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score,
        vectorScore,
        textScore,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

/**
 * Simple BM25-like scoring (term frequency / document length).
 */
function bm25Score(query: string, document: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const docLower = document.toLowerCase();
  const docWords = docLower.split(/\s+/).length;

  let score = 0;
  for (const term of queryTerms) {
    const regex = new RegExp(escapeRegex(term), "gi");
    const matches = docLower.match(regex);
    if (matches) {
      // TF-like scoring normalized by doc length
      score += matches.length / (docWords + 10);
    }
  }

  return Math.min(score, 1);
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
