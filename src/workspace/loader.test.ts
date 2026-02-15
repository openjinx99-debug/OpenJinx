import { mkdtempSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { WORKSPACE_FILES, loadWorkspaceFiles } from "./loader.js";

let tmpDir: string;

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

describe("loadWorkspaceFiles", () => {
  it("loads all 8 workspace files", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "jinx-workspace-test-"));

    // Create all workspace files
    for (const name of WORKSPACE_FILES) {
      writeFileSync(path.join(tmpDir, name), `Content of ${name}`, "utf-8");
    }

    const files = await loadWorkspaceFiles(tmpDir);
    expect(files).toHaveLength(8);
    expect(files.every((f) => !f.missing)).toBe(true);
    expect(files.every((f) => f.content.length > 0)).toBe(true);

    // Verify the names match in order
    const names = files.map((f) => f.name);
    expect(names).toEqual([...WORKSPACE_FILES]);
  });

  it("marks missing files", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "jinx-workspace-test-"));

    // Only create SOUL.md
    writeFileSync(path.join(tmpDir, "SOUL.md"), "Soul content", "utf-8");

    const files = await loadWorkspaceFiles(tmpDir);
    expect(files).toHaveLength(8);

    const soulFile = files.find((f) => f.name === "SOUL.md");
    expect(soulFile).toBeDefined();
    expect(soulFile!.missing).toBe(false);
    expect(soulFile!.content).toBe("Soul content");

    // All others should be missing
    const otherFiles = files.filter((f) => f.name !== "SOUL.md");
    expect(otherFiles.every((f) => f.missing)).toBe(true);
    expect(otherFiles.every((f) => f.content === "")).toBe(true);
  });

  it("reads file content", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "jinx-workspace-test-"));
    writeFileSync(path.join(tmpDir, "SOUL.md"), "Hello", "utf-8");

    const files = await loadWorkspaceFiles(tmpDir);
    const soulFile = files.find((f) => f.name === "SOUL.md");
    expect(soulFile).toBeDefined();
    expect(soulFile!.content).toBe("Hello");
    expect(soulFile!.path).toBe(path.join(tmpDir, "SOUL.md"));
  });

  it("handles empty directory", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "jinx-workspace-test-"));

    const files = await loadWorkspaceFiles(tmpDir);
    expect(files).toHaveLength(8);
    expect(files.every((f) => f.missing)).toBe(true);
    expect(files.every((f) => f.content === "")).toBe(true);
  });
});
