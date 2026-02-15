import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { ensureWorkspace } from "./bootstrap.js";
import { WORKSPACE_FILES } from "./loader.js";

describe("ensureWorkspace", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates the workspace directory if it does not exist", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-workspace-"));
    const workspaceDir = path.join(tmpDir, "new-workspace");

    await ensureWorkspace(workspaceDir);

    expect(fs.existsSync(workspaceDir)).toBe(true);
  });

  it("creates workspace files from templates or empty stubs", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-workspace-"));
    const workspaceDir = path.join(tmpDir, "workspace");

    await ensureWorkspace(workspaceDir);

    // Every WORKSPACE_FILE should exist
    for (const filename of WORKSPACE_FILES) {
      const filePath = path.join(workspaceDir, filename);
      expect(fs.existsSync(filePath)).toBe(true);

      const content = await fsp.readFile(filePath, "utf-8");
      // File should have some content (either template or stub header)
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("does not overwrite existing workspace files", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-workspace-"));
    const workspaceDir = path.join(tmpDir, "workspace");

    // Create workspace first time
    await ensureWorkspace(workspaceDir);

    // Write custom content to one file
    const soulPath = path.join(workspaceDir, "SOUL.md");
    await fsp.writeFile(soulPath, "My custom soul content", "utf-8");

    // Run ensureWorkspace again
    await ensureWorkspace(workspaceDir);

    // Custom content should be preserved
    const content = await fsp.readFile(soulPath, "utf-8");
    expect(content).toBe("My custom soul content");
  });

  it("works with an already existing but empty workspace directory", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-workspace-"));

    // tmpDir already exists and is empty
    await ensureWorkspace(tmpDir);

    for (const filename of WORKSPACE_FILES) {
      expect(fs.existsSync(path.join(tmpDir, filename))).toBe(true);
    }
  });

  it("creates deeply nested workspace directories", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-workspace-"));
    const workspaceDir = path.join(tmpDir, "a", "b", "c", "workspace");

    await ensureWorkspace(workspaceDir);

    expect(fs.existsSync(workspaceDir)).toBe(true);
    // Spot check one file
    expect(fs.existsSync(path.join(workspaceDir, "SOUL.md"))).toBe(true);
  });
});
