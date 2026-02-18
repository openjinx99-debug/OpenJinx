import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { autoDetectDeliverables, isManifestDeliverablePath } from "./marathon-artifacts.js";

describe("autoDetectDeliverables", () => {
  it("prioritizes complete build output bundles from dist/", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "marathon-artifacts-"));
    try {
      await fs.mkdir(path.join(workspaceDir, "dist", "assets"), { recursive: true });
      await fs.mkdir(path.join(workspaceDir, "node_modules", "ignored"), {
        recursive: true,
      });
      await fs.mkdir(path.join(workspaceDir, "src"), { recursive: true });

      await fs.writeFile(path.join(workspaceDir, "dist", "index.html"), "<html></html>", "utf-8");
      await fs.writeFile(
        path.join(workspaceDir, "dist", "assets", "app.js"),
        "console.log('ok')",
        "utf-8",
      );
      await fs.writeFile(
        path.join(workspaceDir, "dist", "assets", "app.css"),
        "body{margin:0}",
        "utf-8",
      );
      await fs.writeFile(path.join(workspaceDir, "src", "main.ts"), "export {};", "utf-8");
      await fs.writeFile(
        path.join(workspaceDir, "node_modules", "ignored", "junk.js"),
        "noop",
        "utf-8",
      );

      const result = await autoDetectDeliverables(workspaceDir);

      expect(result).toHaveLength(3);
      expect(result.every((file) => file.includes(`${path.sep}dist${path.sep}`))).toBe(true);
      expect(result.some((file) => file.includes("node_modules"))).toBe(false);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

describe("isManifestDeliverablePath", () => {
  it("rejects blocked paths and traversal-like entries", () => {
    expect(isManifestDeliverablePath(".")).toBe(false);
    expect(isManifestDeliverablePath("../secret.txt")).toBe(false);
    expect(isManifestDeliverablePath("node_modules/react/index.js")).toBe(false);
    expect(isManifestDeliverablePath(".git/config")).toBe(false);
  });

  it("allows normal artifact-like entries", () => {
    expect(isManifestDeliverablePath("dist/index.html")).toBe(true);
    expect(isManifestDeliverablePath("out/report.pdf")).toBe(true);
  });
});
