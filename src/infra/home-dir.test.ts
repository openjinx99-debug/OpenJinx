import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveHomeDir, expandTilde, homeRelative } from "./home-dir.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveHomeDir", () => {
  it("returns ~/.jinx by default", () => {
    vi.stubEnv("JINX_HOME", "");
    expect(resolveHomeDir()).toBe(path.join(os.homedir(), ".jinx"));
  });

  it("respects JINX_HOME env var", () => {
    vi.stubEnv("JINX_HOME", "/tmp/custom-jinx");
    expect(resolveHomeDir()).toBe("/tmp/custom-jinx");
  });
});

describe("expandTilde", () => {
  it("expands ~ prefix", () => {
    expect(expandTilde("~/foo")).toBe(path.join(os.homedir(), "foo"));
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandTilde("/usr/local")).toBe("/usr/local");
  });

  it("leaves relative paths unchanged", () => {
    expect(expandTilde("foo/bar")).toBe("foo/bar");
  });
});

describe("homeRelative", () => {
  it("resolves relative to home dir", () => {
    vi.stubEnv("JINX_HOME", "");
    expect(homeRelative("config.yaml")).toBe(path.join(os.homedir(), ".jinx", "config.yaml"));
  });
});
