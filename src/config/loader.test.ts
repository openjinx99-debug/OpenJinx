import { mkdtempSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveConfigPath, loadRawConfig } from "./loader.js";

let tmpDir: string;
let savedJinxConfig: string | undefined;
let savedJinxHome: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "jinx-config-test-"));
  savedJinxConfig = process.env.JINX_CONFIG;
  savedJinxHome = process.env.JINX_HOME;
});

afterEach(async () => {
  if (savedJinxConfig === undefined) {
    delete process.env.JINX_CONFIG;
  } else {
    process.env.JINX_CONFIG = savedJinxConfig;
  }
  if (savedJinxHome === undefined) {
    delete process.env.JINX_HOME;
  } else {
    process.env.JINX_HOME = savedJinxHome;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("resolveConfigPath", () => {
  it("uses JINX_CONFIG env", () => {
    process.env.JINX_CONFIG = "/custom/path/config.yaml";
    const result = resolveConfigPath();
    expect(result).toBe("/custom/path/config.yaml");
  });

  it("falls back to home dir", () => {
    delete process.env.JINX_CONFIG;
    process.env.JINX_HOME = tmpDir;
    const result = resolveConfigPath();
    expect(result).toBe(path.join(tmpDir, "config.yaml"));
  });
});

describe("loadRawConfig", () => {
  it("reads YAML file", async () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "llm:\n  model: test-model\n", "utf-8");

    const result = await loadRawConfig(configPath);
    expect(result).toEqual({ llm: { model: "test-model" } });
  });

  it("reads JSON file", async () => {
    const configPath = path.join(tmpDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ llm: { model: "json-model" } }), "utf-8");

    const result = await loadRawConfig(configPath);
    expect(result).toEqual({ llm: { model: "json-model" } });
  });

  it("returns empty for missing file", async () => {
    const result = await loadRawConfig(path.join(tmpDir, "nonexistent.yaml"));
    expect(result).toEqual({});
  });

  it("throws on read error", async () => {
    // Pass a directory path as if it were a file — readFile should fail
    await expect(loadRawConfig(tmpDir)).rejects.toThrow();
  });
});
