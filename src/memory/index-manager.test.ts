import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { discoverMemoryFiles, hashContent, indexFile, syncIndex } from "./index-manager.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jinx-idx-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("discoverMemoryFiles", () => {
  it("finds markdown files in directory", async () => {
    await fs.writeFile(path.join(tmpDir, "notes.md"), "# Notes", "utf-8");
    await fs.writeFile(path.join(tmpDir, "todo.md"), "# Todo", "utf-8");
    await fs.writeFile(path.join(tmpDir, "data.json"), "{}", "utf-8");

    const files = await discoverMemoryFiles(tmpDir);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".md"))).toBe(true);
  });

  it("finds files recursively in subdirectories", async () => {
    await fs.mkdir(path.join(tmpDir, "sub"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "root.md"), "# Root", "utf-8");
    await fs.writeFile(path.join(tmpDir, "sub", "nested.md"), "# Nested", "utf-8");

    const files = await discoverMemoryFiles(tmpDir);
    expect(files).toHaveLength(2);
  });

  it("returns empty array for non-existent directory", async () => {
    const files = await discoverMemoryFiles("/tmp/nonexistent-jinx-dir-xxx");
    expect(files).toEqual([]);
  });

  it("returns empty array for empty directory", async () => {
    const files = await discoverMemoryFiles(tmpDir);
    expect(files).toEqual([]);
  });
});

describe("hashContent", () => {
  it("produces consistent 16-char hex hash", () => {
    const hash = hashContent("Hello, world!");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("produces same hash for same content", () => {
    expect(hashContent("foo")).toBe(hashContent("foo"));
  });

  it("produces different hashes for different content", () => {
    expect(hashContent("foo")).not.toBe(hashContent("bar"));
  });
});

describe("indexFile", () => {
  it("reads file, hashes content, and chunks it", async () => {
    const filePath = path.join(tmpDir, "test.md");
    await fs.writeFile(filePath, "# Title\n\nSome content here.", "utf-8");

    const indexed = await indexFile(filePath);
    expect(indexed.path).toBe(filePath);
    expect(indexed.hash).toHaveLength(16);
    expect(indexed.chunks.length).toBeGreaterThan(0);
    expect(indexed.chunks[0].content).toContain("Title");
  });
});

describe("syncIndex", () => {
  it("indexes new files and records their hashes", async () => {
    await fs.writeFile(path.join(tmpDir, "a.md"), "# File A\nContent A.", "utf-8");
    await fs.writeFile(path.join(tmpDir, "b.md"), "# File B\nContent B.", "utf-8");

    const knownHashes = new Map<string, string>();
    const updated = await syncIndex(tmpDir, knownHashes);

    expect(updated).toHaveLength(2);
    expect(knownHashes.size).toBe(2);
  });

  it("skips unchanged files on re-sync", async () => {
    await fs.writeFile(path.join(tmpDir, "a.md"), "# File A", "utf-8");

    const knownHashes = new Map<string, string>();
    const first = await syncIndex(tmpDir, knownHashes);
    expect(first).toHaveLength(1);

    const second = await syncIndex(tmpDir, knownHashes);
    expect(second).toHaveLength(0);
  });

  it("re-indexes changed files", async () => {
    const filePath = path.join(tmpDir, "a.md");
    await fs.writeFile(filePath, "# Version 1", "utf-8");

    const knownHashes = new Map<string, string>();
    await syncIndex(tmpDir, knownHashes);

    await fs.writeFile(filePath, "# Version 2 with changes", "utf-8");
    const updated = await syncIndex(tmpDir, knownHashes);
    expect(updated).toHaveLength(1);
    expect(updated[0].chunks[0].content).toContain("Version 2");
  });
});
