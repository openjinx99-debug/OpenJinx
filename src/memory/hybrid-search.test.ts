import { describe, expect, it } from "vitest";
import { hybridSearch, type SearchIndex } from "./hybrid-search.js";

const index: SearchIndex = {
  chunks: [
    {
      filePath: "notes/cooking.md",
      content: "The best way to cook pasta is al dente in salted boiling water.",
      startLine: 1,
      endLine: 1,
    },
    {
      filePath: "notes/programming.md",
      content: "TypeScript is a typed superset of JavaScript that compiles to plain JS.",
      startLine: 1,
      endLine: 1,
    },
    {
      filePath: "notes/cooking.md",
      content: "For pizza dough, use high-protein flour and let it rise slowly.",
      startLine: 5,
      endLine: 5,
    },
  ],
};

describe("hybridSearch", () => {
  it("finds relevant chunks by text", () => {
    const results = hybridSearch("how to cook pasta", undefined, index, 10, 0);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].filePath).toBe("notes/cooking.md");
    expect(results[0].chunk).toContain("pasta");
  });

  it("respects maxResults", () => {
    const results = hybridSearch("cook", undefined, index, 1, 0);
    expect(results).toHaveLength(1);
  });

  it("returns empty for unrelated queries", () => {
    const results = hybridSearch("quantum physics", undefined, index, 10, 0);
    expect(results).toHaveLength(0);
  });

  it("scores results", () => {
    const results = hybridSearch("TypeScript", undefined, index, 10, 0);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].textScore).toBeGreaterThan(0);
  });

  it("pure BM25 mode (vectorWeight=0) uses only text scoring", () => {
    const results = hybridSearch("pasta boil water", undefined, index, 10, 0);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.vectorScore).toBe(0);
      expect(r.score).toBe(r.textScore);
    }
  });

  it("pure vector mode (vectorWeight=1) uses only vector scoring", () => {
    // Without embeddings, vector scores are 0, so results should have score 0
    const results = hybridSearch("test", undefined, index, 10, 1);
    // All scores should be 0 since no embeddings
    for (const r of results) {
      expect(r.score).toBe(0);
    }
    // BM25 alone won't contribute
    expect(results).toHaveLength(0);
  });

  it("hybrid weighting blends vector and text scores", () => {
    // Create index with fake embeddings
    const embeddingIndex: SearchIndex = {
      chunks: [
        {
          filePath: "a.md",
          content: "cooking recipes and food preparation",
          startLine: 1,
          endLine: 1,
          embedding: [0.8, 0.1, 0.1],
        },
        {
          filePath: "b.md",
          content: "cooking tips for beginners",
          startLine: 1,
          endLine: 1,
          embedding: [0.2, 0.9, 0.1],
        },
      ],
    };

    const queryEmbedding = [0.7, 0.2, 0.1]; // More similar to first chunk
    const results = hybridSearch("cooking", queryEmbedding, embeddingIndex, 10, 0.5);
    expect(results.length).toBe(2);
    // Both should have non-zero scores from both components
    for (const r of results) {
      expect(r.textScore).toBeGreaterThan(0);
      expect(r.vectorScore).toBeGreaterThan(0);
    }
  });

  it("results sorted by descending score", () => {
    const results = hybridSearch("cook", undefined, index, 10, 0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("handles mismatched embedding dimensions gracefully", () => {
    const mismatchIndex: SearchIndex = {
      chunks: [
        {
          filePath: "a.md",
          content: "some content to match",
          startLine: 1,
          endLine: 1,
          embedding: [1, 2, 3],
        },
      ],
    };

    // Query embedding has 2 dimensions, chunk has 3 — cosine similarity should return 0
    const results = hybridSearch("some content", [1, 2], mismatchIndex, 10, 0.5);
    // The text component still matches, so there should be results
    expect(results.length).toBeGreaterThan(0);
    // Vector score should be 0 due to dimension mismatch
    expect(results[0].vectorScore).toBe(0);
  });

  it("handles zero-vector embeddings", () => {
    const zeroIndex: SearchIndex = {
      chunks: [
        {
          filePath: "zero.md",
          content: "zero vector test content",
          startLine: 1,
          endLine: 1,
          embedding: [0, 0, 0],
        },
      ],
    };

    // denom will be 0 since one vector is all zeros
    const results = hybridSearch("zero vector test", [1, 1, 1], zeroIndex, 10, 0.5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].vectorScore).toBe(0);
  });

  it("scores are numeric and non-negative", () => {
    const results = hybridSearch("cook", undefined, index, 10, 0);
    for (const r of results) {
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(typeof r.textScore).toBe("number");
      expect(r.textScore).toBeGreaterThanOrEqual(0);
      expect(typeof r.vectorScore).toBe("number");
      expect(r.vectorScore).toBeGreaterThanOrEqual(0);
    }
  });
});
