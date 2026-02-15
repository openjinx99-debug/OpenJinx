import fs from "node:fs/promises";
/**
 * System test: Memory Lifecycle.
 * Crosses: Memory + Agent + Sessions.
 *
 * Verifies writing, indexing, searching, and cross-session persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { MemoryConfig } from "../types/config.js";
import { createTestHarness, type TestHarness } from "../__test__/harness.js";
import { discoverMemoryFiles } from "../memory/index-manager.js";
import { MemorySearchManager } from "../memory/search-manager.js";

let harness: TestHarness;
let memoryConfig: MemoryConfig;

beforeEach(async () => {
  harness = await createTestHarness();
  memoryConfig = {
    enabled: true,
    dir: harness.workspace.memoryDir,
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    vectorWeight: 0, // Pure BM25
    maxResults: 10,
  };
});

afterEach(async () => {
  await harness.cleanup();
});

describe("Memory lifecycle system tests", () => {
  it("write daily log → index → search → retrieve across sessions", async () => {
    // Session 1: Write a daily log
    await harness.workspace.writeDailyLog(
      "2026-02-10",
      "# 2026-02-10\n\nHad architecture review meeting.\nDecided to use event-driven architecture.\nKey components: message broker, event handlers, state store.\n",
    );

    const manager1 = new MemorySearchManager(memoryConfig);
    await manager1.sync();

    // Search within Session 1
    const results1 = await manager1.search({ query: "architecture event-driven" });
    expect(results1.length).toBeGreaterThan(0);
    expect(results1[0].chunk).toContain("event-driven");

    // Session 2: New search manager (simulates restart — loads persisted index)
    const manager2 = new MemorySearchManager(memoryConfig);
    await manager2.init();

    // Search finds the same content via persisted index (no re-indexing needed)
    const results2 = await manager2.search({ query: "message broker" });
    expect(results2.length).toBeGreaterThan(0);
    expect(results2[0].chunk).toContain("message broker");
  });

  it("memory index detects file changes and re-indexes", async () => {
    const filePath = await harness.workspace.writeDailyLog(
      "2026-02-10",
      "# 2026-02-10\n\nOriginal notes about Python migration.\n",
    );

    const manager = new MemorySearchManager(memoryConfig);
    await manager.sync();

    // Verify original content is searchable
    let results = await manager.search({ query: "Python migration" });
    expect(results.length).toBeGreaterThan(0);

    // Modify the file
    await fs.writeFile(
      filePath,
      "# 2026-02-10\n\nUpdated: Decided against Python migration.\nWill use TypeScript with Bun instead.\n",
      "utf-8",
    );

    // Re-sync detects the change
    await manager.sync();
    const status = manager.getStatus();
    expect(status.totalChunks).toBeGreaterThan(0);

    // New content is now searchable
    results = await manager.search({ query: "TypeScript Bun" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk).toContain("Bun");
  });

  it("search returns results sorted by relevance", async () => {
    await harness.workspace.writeDailyLog(
      "2026-02-10",
      "# 2026-02-10\n\nWorked on TypeScript compiler optimizations.\nFixed TypeScript type inference bugs.\n",
    );
    await harness.workspace.writeDailyLog(
      "2026-02-11",
      "# 2026-02-11\n\nReviewed PR for Python linter.\nBrief mention of TypeScript.\n",
    );

    const manager = new MemorySearchManager(memoryConfig);
    const results = await manager.search({ query: "TypeScript compiler" });

    expect(results.length).toBeGreaterThan(0);

    // Results should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }

    // The more relevant file should rank higher
    if (results.length >= 2) {
      expect(results[0].filePath).toContain("2026-02-10");
    }
  });

  it("memory discovery finds all markdown files", async () => {
    await harness.workspace.writeDailyLog("2026-01-01", "# Jan 1\n");
    await harness.workspace.writeDailyLog("2026-01-15", "# Jan 15\n");
    await harness.workspace.writeDailyLog("2026-02-01", "# Feb 1\n");

    const files = await discoverMemoryFiles(harness.workspace.memoryDir);

    // Should find at least the 3 we just wrote + 2 defaults from workspace factory
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.every((f) => f.endsWith(".md"))).toBe(true);
  });

  it("path filter narrows search to specific files", async () => {
    await harness.workspace.writeDailyLog(
      "2026-02-10",
      "# Work Log\n\nWorked on the API server.\n",
    );
    await harness.workspace.writeDailyLog(
      "2026-02-11",
      "# Personal\n\nAlso worked on API for side project.\n",
    );

    const manager = new MemorySearchManager(memoryConfig);
    await manager.sync();

    const results = await manager.search({
      query: "API",
      pathFilter: ["2026-02-10"],
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.filePath.includes("2026-02-10"))).toBe(true);
  });
});
