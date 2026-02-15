import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SearchIndex } from "./hybrid-search.js";
import { saveIndex, loadIndex } from "./persistence.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jinx-persist-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeIndex(chunks: SearchIndex["chunks"] = []): SearchIndex {
  return { chunks };
}

describe("saveIndex + loadIndex", () => {
  it("round-trips empty index", async () => {
    const index = makeIndex();
    const hashes = new Map<string, string>();

    await saveIndex(tmpDir, index, hashes);
    const loaded = await loadIndex(tmpDir);

    expect(loaded).toBeDefined();
    expect(loaded!.index.chunks).toEqual([]);
    expect(loaded!.knownHashes.size).toBe(0);
  });

  it("round-trips index with chunks and hashes", async () => {
    const chunks = [
      {
        filePath: "/mem/notes.md",
        content: "Hello world",
        startLine: 1,
        endLine: 5,
      },
      {
        filePath: "/mem/todo.md",
        content: "Buy groceries",
        startLine: 1,
        endLine: 3,
      },
    ];
    const index = makeIndex(chunks);
    const hashes = new Map([
      ["/mem/notes.md", "abc123"],
      ["/mem/todo.md", "def456"],
    ]);

    await saveIndex(tmpDir, index, hashes);
    const loaded = await loadIndex(tmpDir);

    expect(loaded).toBeDefined();
    expect(loaded!.index.chunks).toHaveLength(2);
    expect(loaded!.index.chunks[0].content).toBe("Hello world");
    expect(loaded!.index.chunks[1].content).toBe("Buy groceries");
    expect(loaded!.knownHashes.get("/mem/notes.md")).toBe("abc123");
    expect(loaded!.knownHashes.get("/mem/todo.md")).toBe("def456");
  });

  it("preserves embedding vectors", async () => {
    const embedding = [0.1, 0.2, 0.3, 0.4];
    const chunks = [
      {
        filePath: "/mem/notes.md",
        content: "with embedding",
        startLine: 1,
        endLine: 2,
        embedding,
      },
    ];
    const index = makeIndex(chunks);
    const hashes = new Map([["/mem/notes.md", "abc"]]);

    await saveIndex(tmpDir, index, hashes);
    const loaded = await loadIndex(tmpDir);

    expect(loaded!.index.chunks[0].embedding).toEqual(embedding);
  });

  it("returns undefined when no persisted index exists", async () => {
    const loaded = await loadIndex(tmpDir);
    expect(loaded).toBeUndefined();
  });

  it("returns undefined for corrupted file", async () => {
    await fs.writeFile(path.join(tmpDir, ".search-index.json"), "not json", "utf-8");
    const loaded = await loadIndex(tmpDir);
    expect(loaded).toBeUndefined();
  });

  it("creates file with restricted permissions", async () => {
    await saveIndex(tmpDir, makeIndex(), new Map());
    const stats = await fs.stat(path.join(tmpDir, ".search-index.json"));
    // 0o600 = owner read/write only
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
