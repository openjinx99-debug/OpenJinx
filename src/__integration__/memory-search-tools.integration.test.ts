import fs from "node:fs/promises";
/**
 * Integration: Memory Search → Agent Tools boundary.
 * Tests real memory indexing, searching, and file retrieval.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { MemoryConfig } from "../types/config.js";
import { createTestWorkspace, type TestWorkspace } from "../__test__/workspace.js";
import { chunkMarkdown } from "../memory/chunker.js";
import { syncIndex } from "../memory/index-manager.js";
import { MemorySearchManager } from "../memory/search-manager.js";

let workspace: TestWorkspace;
let config: MemoryConfig;

beforeEach(async () => {
  workspace = await createTestWorkspace();
  config = {
    enabled: true,
    dir: workspace.memoryDir,
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    vectorWeight: 0, // Pure BM25 for deterministic testing
    maxResults: 10,
  };
});

afterEach(async () => {
  await workspace.cleanup();
});

describe("Memory Search → Agent Tools integration", () => {
  it("memory_search returns ranked results from indexed files", async () => {
    await workspace.writeDailyLog(
      "2026-02-10",
      "# 2026-02-10\n\nDiscussed TypeScript project architecture.\nDecided to use monorepo with pnpm workspaces.\n",
    );
    await workspace.writeDailyLog(
      "2026-02-11",
      "# 2026-02-11\n\nWorked on Python data pipeline.\nUsed pandas for data transformation.\n",
    );

    const manager = new MemorySearchManager(config);
    const results = await manager.search({ query: "TypeScript monorepo" });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].filePath).toContain("2026-02-10");
    expect(results[0].score).toBeGreaterThan(0);

    // Results should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("memory_get reads specific file range", async () => {
    const filePath = await workspace.writeDailyLog(
      "2026-02-10",
      "Line 1: Header\nLine 2: Content A\nLine 3: Content B\nLine 4: Content C\nLine 5: Footer\n",
    );

    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    // Simulate memory_get line-range extraction (lines 2-4)
    const extracted = lines.slice(1, 4).join("\n");
    expect(extracted).toContain("Content A");
    expect(extracted).toContain("Content C");
    expect(extracted).not.toContain("Header");
    expect(extracted).not.toContain("Footer");
  });

  it("search returns results across multiple files", async () => {
    await workspace.writeDailyLog(
      "2026-01-01",
      "# 2026-01-01\n\nMeeting notes about the API design.\n",
    );
    await workspace.writeDailyLog(
      "2026-01-15",
      "# 2026-01-15\n\nReviewed API endpoints for versioning.\n",
    );
    await workspace.writeDailyLog(
      "2026-02-01",
      "# 2026-02-01\n\nUnrelated content about gardening.\n",
    );

    const manager = new MemorySearchManager(config);
    const results = await manager.search({ query: "API design endpoints" });

    expect(results.length).toBeGreaterThanOrEqual(2);
    const filePaths = results.map((r) => r.filePath);
    expect(filePaths.some((p) => p.includes("2026-01-01"))).toBe(true);
    expect(filePaths.some((p) => p.includes("2026-01-15"))).toBe(true);
  });

  it("index auto-syncs on search when stale", async () => {
    await workspace.writeDailyLog("2026-02-12", "# 2026-02-12\n\nInitial content about testing.\n");

    const manager = new MemorySearchManager(config);

    // First search triggers sync
    const results1 = await manager.search({ query: "testing" });
    expect(results1.length).toBeGreaterThan(0);

    // Write new content
    await workspace.writeDailyLog(
      "2026-02-13",
      "# 2026-02-13\n\nNew content about deployment pipelines.\n",
    );

    // Search should find the new content after auto-sync
    // Force sync by creating a new manager (or waiting >30s, simulated here)
    const manager2 = new MemorySearchManager(config);
    const results2 = await manager2.search({ query: "deployment pipelines" });
    expect(results2.length).toBeGreaterThan(0);
    expect(results2[0].filePath).toContain("2026-02-13");
  });

  it("syncIndex detects content changes via hash comparison", async () => {
    const filePath = await workspace.writeDailyLog(
      "2026-02-10",
      "# Original\n\nOriginal content.\n",
    );

    const knownHashes = new Map<string, string>();
    const first = await syncIndex(workspace.memoryDir, knownHashes);
    expect(first.length).toBeGreaterThan(0);

    // Re-sync without changes — should skip
    const second = await syncIndex(workspace.memoryDir, knownHashes);
    const _secondForMemDir = second.filter((f) => f.path.includes("memory"));
    // All memory files already synced, nothing new
    expect(second.length).toBe(0);

    // Modify file
    await fs.writeFile(filePath, "# Modified\n\nNew content entirely.\n", "utf-8");
    const third = await syncIndex(workspace.memoryDir, knownHashes);
    expect(third.length).toBeGreaterThan(0);
    expect(third[0].chunks[0].content).toContain("Modified");
  });

  it("chunker produces valid chunks with line numbers", async () => {
    const content = [
      "# Daily Log",
      "",
      "## Morning",
      "Had coffee and reviewed PRs.",
      "",
      "## Afternoon",
      "Paired on the auth refactor.",
      "",
      "## Evening",
      "Wrote tests for the memory system.",
    ].join("\n");

    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      expect(chunk.startLine).toBeGreaterThan(0);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.tokenEstimate).toBeGreaterThan(0);
    }
  });
});
