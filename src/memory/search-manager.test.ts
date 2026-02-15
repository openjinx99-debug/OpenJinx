import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { MemoryConfig } from "../types/config.js";
import { MemorySearchManager } from "./search-manager.js";

let tmpDir: string;
let config: MemoryConfig;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jinx-search-test-"));
  config = {
    enabled: true,
    dir: tmpDir,
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    vectorWeight: 0, // Pure BM25 for deterministic tests
    maxResults: 10,
  };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("MemorySearchManager", () => {
  it("syncs and searches indexed files", async () => {
    await fs.writeFile(
      path.join(tmpDir, "cooking.md"),
      "# Cooking\n\nThe best way to make pasta is to boil water with salt.",
      "utf-8",
    );
    await fs.writeFile(
      path.join(tmpDir, "coding.md"),
      "# Coding\n\nTypeScript is great for building large applications.",
      "utf-8",
    );

    const manager = new MemorySearchManager(config);
    await manager.sync();

    const results = await manager.search({ query: "pasta cooking" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].filePath).toContain("cooking.md");
  });

  it("auto-syncs when stale on search", async () => {
    await fs.writeFile(
      path.join(tmpDir, "notes.md"),
      "# Notes\n\nImportant meeting tomorrow.",
      "utf-8",
    );

    const manager = new MemorySearchManager(config);
    // Don't call sync() manually — search should trigger it
    const results = await manager.search({ query: "meeting" });
    expect(results.length).toBeGreaterThan(0);
  });

  it("applies path filter", async () => {
    await fs.writeFile(
      path.join(tmpDir, "work.md"),
      "# Work\n\nProject deadline is Friday.",
      "utf-8",
    );
    await fs.writeFile(
      path.join(tmpDir, "personal.md"),
      "# Personal\n\nProject garden for spring.",
      "utf-8",
    );

    const manager = new MemorySearchManager(config);
    await manager.sync();

    const results = await manager.search({
      query: "project",
      pathFilter: ["work.md"],
    });
    expect(results.every((r) => r.filePath.includes("work.md"))).toBe(true);
  });

  it("applies minScore filter", async () => {
    await fs.writeFile(
      path.join(tmpDir, "notes.md"),
      "# Notes\n\nRandom text about nothing relevant to quantum physics.",
      "utf-8",
    );

    const manager = new MemorySearchManager(config);
    await manager.sync();

    const results = await manager.search({
      query: "quantum physics",
      minScore: 0.5,
    });
    // With BM25 only, score might be low — verify filtering works
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("reports status correctly", async () => {
    await fs.writeFile(path.join(tmpDir, "a.md"), "# A\nContent.", "utf-8");
    await fs.writeFile(path.join(tmpDir, "b.md"), "# B\nContent.", "utf-8");

    const manager = new MemorySearchManager(config);
    await manager.sync();

    const status = manager.getStatus();
    expect(status.totalFiles).toBe(2);
    expect(status.totalChunks).toBeGreaterThanOrEqual(2);
    expect(status.syncing).toBe(false);
    expect(status.lastSyncAt).toBeDefined();
  });

  it("persists index across instances via init()", async () => {
    await fs.writeFile(
      path.join(tmpDir, "persist.md"),
      "# Persist\n\nThis content should survive restart.",
      "utf-8",
    );

    // First instance: sync and persist
    const manager1 = new MemorySearchManager(config);
    await manager1.sync();

    const status1 = manager1.getStatus();
    expect(status1.totalChunks).toBeGreaterThan(0);

    // Second instance: load persisted index
    const manager2 = new MemorySearchManager(config);
    await manager2.init();

    const status2 = manager2.getStatus();
    expect(status2.totalChunks).toBe(status1.totalChunks);

    // Should be searchable without sync
    const results = await manager2.search({ query: "survive restart" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].filePath).toContain("persist.md");
  });

  it("detects file changes and re-indexes on sync", async () => {
    const filePath = path.join(tmpDir, "evolving.md");
    await fs.writeFile(filePath, "# V1\n\nOriginal content about bananas.", "utf-8");

    const manager = new MemorySearchManager(config);
    await manager.sync();

    let results = await manager.search({ query: "bananas" });
    expect(results.length).toBeGreaterThan(0);

    // Change the file
    await fs.writeFile(filePath, "# V2\n\nUpdated content about mangoes instead.", "utf-8");

    // Force re-sync by clearing internal lastSyncAt
    await manager.sync();

    results = await manager.search({ query: "mangoes" });
    expect(results.length).toBeGreaterThan(0);
  });
});
