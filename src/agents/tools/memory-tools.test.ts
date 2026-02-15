import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMemoryToolDefinitions } from "./memory-tools.js";

function findTool(name: string, memoryDir: string) {
  const tools = getMemoryToolDefinitions({ memoryDir });
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

describe("memory-tools", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-memory-tools-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── memory_search ───────────────────────────────────────────────────

  describe("memory_search", () => {
    it("finds matching text in memory files", async () => {
      fs.writeFileSync(path.join(tmpDir, "notes.md"), "Line 1\nImportant finding\nLine 3\n");

      const tool = findTool("memory_search", tmpDir);
      const result = (await tool.execute({ query: "Important" })) as {
        results: { file: string; line: number; text: string }[];
      };
      expect(result.results).toHaveLength(1);
      expect(result.results[0].file).toBe("notes.md");
      expect(result.results[0].line).toBe(2);
      expect(result.results[0].text).toBe("Important finding");
    });

    it("search is case-insensitive", async () => {
      fs.writeFileSync(path.join(tmpDir, "notes.md"), "UPPER case text\n");

      const tool = findTool("memory_search", tmpDir);
      const result = (await tool.execute({ query: "upper" })) as {
        results: { file: string }[];
      };
      expect(result.results).toHaveLength(1);
    });

    it("returns empty for no matches", async () => {
      fs.writeFileSync(path.join(tmpDir, "notes.md"), "nothing here\n");

      const tool = findTool("memory_search", tmpDir);
      const result = (await tool.execute({ query: "zzz_no_match_zzz" })) as {
        results: unknown[];
      };
      expect(result.results).toHaveLength(0);
    });

    it("respects max_results limit", async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `match line ${i}`).join("\n");
      fs.writeFileSync(path.join(tmpDir, "many.md"), lines);

      const tool = findTool("memory_search", tmpDir);
      const result = (await tool.execute({ query: "match", max_results: 3 })) as {
        results: unknown[];
      };
      expect(result.results).toHaveLength(3);
    });

    it("searches nested directories", async () => {
      fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "sub", "deep.md"), "nested target\n");

      const tool = findTool("memory_search", tmpDir);
      const result = (await tool.execute({ query: "nested target" })) as {
        results: { file: string }[];
      };
      expect(result.results).toHaveLength(1);
      expect(result.results[0].file).toBe(path.join("sub", "deep.md"));
    });

    it("includes source: memory field in search results", async () => {
      fs.writeFileSync(path.join(tmpDir, "notes.md"), "Remember this fact\n");

      const tool = findTool("memory_search", tmpDir);
      const result = (await tool.execute({ query: "Remember" })) as {
        results: { file: string; source: string }[];
      };
      expect(result.results).toHaveLength(1);
      expect(result.results[0].source).toBe("memory");
    });

    it("includes surrounding context lines", async () => {
      fs.writeFileSync(path.join(tmpDir, "ctx.md"), "before2\nbefore1\nTARGET\nafter1\nafter2\n");

      const tool = findTool("memory_search", tmpDir);
      const result = (await tool.execute({ query: "TARGET" })) as {
        results: { context: string }[];
      };
      expect(result.results[0].context).toContain("before2");
      expect(result.results[0].context).toContain("TARGET");
      expect(result.results[0].context).toContain("after2");
    });

    it("returns gracefully when memory dir does not exist", async () => {
      const tool = findTool("memory_search", path.join(tmpDir, "nonexistent"));
      const result = (await tool.execute({ query: "anything" })) as {
        results: unknown[];
        message: string;
      };
      expect(result.results).toHaveLength(0);
      expect(result.message).toContain("does not exist");
    });

    it("only searches .md and .txt files", async () => {
      fs.writeFileSync(path.join(tmpDir, "notes.md"), "searchable\n");
      fs.writeFileSync(path.join(tmpDir, "data.json"), '{"searchable": true}\n');

      const tool = findTool("memory_search", tmpDir);
      const result = (await tool.execute({ query: "searchable" })) as {
        results: { file: string }[];
      };
      expect(result.results).toHaveLength(1);
      expect(result.results[0].file).toBe("notes.md");
    });
  });

  // ── memory_get ──────────────────────────────────────────────────────

  describe("memory_get", () => {
    it("reads specific memory file", async () => {
      fs.writeFileSync(path.join(tmpDir, "readme.md"), "Hello Jinx");

      const tool = findTool("memory_get", tmpDir);
      const result = (await tool.execute({ path: "readme.md" })) as {
        content: string;
        path: string;
      };
      expect(result.content).toBe("Hello Jinx");
      expect(result.path).toBe("readme.md");
    });

    it("supports from_line and num_lines pagination", async () => {
      fs.writeFileSync(path.join(tmpDir, "lines.md"), "L1\nL2\nL3\nL4\nL5\n");

      const tool = findTool("memory_get", tmpDir);
      const result = (await tool.execute({
        path: "lines.md",
        from_line: 2,
        num_lines: 2,
      })) as { content: string; lines: number };
      expect(result.content).toBe("L2\nL3");
      expect(result.lines).toBe(2);
    });

    it("rejects path traversal", async () => {
      const tool = findTool("memory_get", tmpDir);
      await expect(tool.execute({ path: "../../etc/passwd" })).rejects.toThrow("Path not allowed");
    });

    it("throws on missing file", async () => {
      const tool = findTool("memory_get", tmpDir);
      await expect(tool.execute({ path: "nonexistent.md" })).rejects.toThrow();
    });

    it("reads nested files", async () => {
      fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "sub", "note.md"), "nested content");

      const tool = findTool("memory_get", tmpDir);
      const result = (await tool.execute({ path: "sub/note.md" })) as { content: string };
      expect(result.content).toBe("nested content");
    });
  });
});
