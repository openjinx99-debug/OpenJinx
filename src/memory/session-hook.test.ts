import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { onSessionEnd } from "./session-hook.js";

let tmpDir: string;

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

describe("onSessionEnd", () => {
  it("creates memory file with slug", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "jinx-session-hook-"));
    const memoryDir = path.join(tmpDir, "memory");

    const result = await onSessionEnd({
      memoryDir,
      sessionKey: "sess-001",
      slug: "test-session",
      summary: "A test summary.",
    });

    const date = new Date().toISOString().slice(0, 10);
    const expectedFilename = `${date}-test-session.md`;
    const expectedPath = path.join(memoryDir, expectedFilename);

    expect(result).toBe(expectedPath);

    // Verify file exists
    const stat = await fs.stat(expectedPath);
    expect(stat.isFile()).toBe(true);
  });

  it("file contains session info", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "jinx-session-hook-"));
    const memoryDir = path.join(tmpDir, "memory");

    await onSessionEnd({
      memoryDir,
      sessionKey: "sess-002",
      slug: "info-check",
      summary: "Summary of session.",
    });

    const date = new Date().toISOString().slice(0, 10);
    const filePath = path.join(memoryDir, `${date}-info-check.md`);
    const content = await fs.readFile(filePath, "utf-8");

    expect(content).toContain("info-check");
    expect(content).toContain("sess-002");
    expect(content).toContain("Summary of session.");
    expect(content).toContain(date);
  });

  it("creates memoryDir if needed", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "jinx-session-hook-"));
    const memoryDir = path.join(tmpDir, "deeply", "nested", "memory");

    await onSessionEnd({
      memoryDir,
      sessionKey: "sess-003",
      slug: "nested-dir",
      summary: "Created nested.",
    });

    const stat = await fs.stat(memoryDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("returns file path", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "jinx-session-hook-"));
    const memoryDir = path.join(tmpDir, "memory");

    const result = await onSessionEnd({
      memoryDir,
      sessionKey: "sess-004",
      slug: "path-check",
      summary: "Checking path.",
    });

    const date = new Date().toISOString().slice(0, 10);
    expect(result).toBe(path.join(memoryDir, `${date}-path-check.md`));

    // Verify the returned path actually exists
    const stat = await fs.stat(result);
    expect(stat.isFile()).toBe(true);
  });
});
