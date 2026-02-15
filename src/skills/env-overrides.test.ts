import { describe, it, expect } from "vitest";
import { applyEnvOverrides } from "./env-overrides.js";

describe("applyEnvOverrides", () => {
  it("sets environment variables", () => {
    const cleanup = applyEnvOverrides({ FOO_TEST_VAR: "bar" });
    try {
      expect(process.env.FOO_TEST_VAR).toBe("bar");
    } finally {
      cleanup();
    }
  });

  it("cleanup restores original values", () => {
    process.env.TEST_ORIG = "orig";
    const cleanup = applyEnvOverrides({ TEST_ORIG: "new" });
    expect(process.env.TEST_ORIG).toBe("new");
    cleanup();
    expect(process.env.TEST_ORIG).toBe("orig");
    delete process.env.TEST_ORIG;
  });

  it("cleanup deletes variables that didn't exist", () => {
    delete process.env.BRAND_NEW_VAR;
    const cleanup = applyEnvOverrides({ BRAND_NEW_VAR: "x" });
    expect(process.env.BRAND_NEW_VAR).toBe("x");
    cleanup();
    expect(process.env.BRAND_NEW_VAR).toBeUndefined();
  });

  it("handles multiple overrides", () => {
    delete process.env.MULTI_A;
    delete process.env.MULTI_B;
    const cleanup = applyEnvOverrides({ MULTI_A: "1", MULTI_B: "2" });
    expect(process.env.MULTI_A).toBe("1");
    expect(process.env.MULTI_B).toBe("2");
    cleanup();
    expect(process.env.MULTI_A).toBeUndefined();
    expect(process.env.MULTI_B).toBeUndefined();
  });

  it("empty overrides returns noop cleanup", () => {
    const cleanup = applyEnvOverrides({});
    expect(() => cleanup()).not.toThrow();
  });

  // ── Security: dangerous env var blocking ────────────────────────────

  it("blocks PATH override and applies safe vars", () => {
    const originalPath = process.env.PATH;
    delete process.env.SAFE_VAR;
    const cleanup = applyEnvOverrides({ PATH: "/evil/bin", SAFE_VAR: "ok" });
    try {
      expect(process.env.PATH).toBe(originalPath);
      expect(process.env.SAFE_VAR).toBe("ok");
    } finally {
      cleanup();
    }
  });

  it("blocks LD_PRELOAD override", () => {
    delete process.env.LD_PRELOAD;
    const cleanup = applyEnvOverrides({ LD_PRELOAD: "/evil.so", ALLOWED: "yes" });
    try {
      expect(process.env.LD_PRELOAD).toBeUndefined();
      expect(process.env.ALLOWED).toBe("yes");
    } finally {
      cleanup();
    }
  });

  it("blocks NODE_OPTIONS override", () => {
    const originalNodeOpts = process.env.NODE_OPTIONS;
    const cleanup = applyEnvOverrides({ NODE_OPTIONS: "--inspect=0.0.0.0" });
    try {
      expect(process.env.NODE_OPTIONS).toBe(originalNodeOpts);
    } finally {
      cleanup();
    }
  });

  it("blocks ANTHROPIC_API_KEY override", () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    const cleanup = applyEnvOverrides({ ANTHROPIC_API_KEY: "sk-stolen" });
    try {
      expect(process.env.ANTHROPIC_API_KEY).toBe(originalKey);
    } finally {
      cleanup();
    }
  });

  it("blocks multiple dangerous vars simultaneously", () => {
    const originalPath = process.env.PATH;
    delete process.env.LD_PRELOAD;
    delete process.env.SAFE_ONE;
    const cleanup = applyEnvOverrides({
      PATH: "/bad",
      DYLD_INSERT_LIBRARIES: "/evil",
      LD_PRELOAD: "/malicious.so",
      SAFE_ONE: "allowed",
    });
    try {
      expect(process.env.PATH).toBe(originalPath);
      expect(process.env.LD_PRELOAD).toBeUndefined();
      expect(process.env.DYLD_INSERT_LIBRARIES).toBeUndefined();
      expect(process.env.SAFE_ONE).toBe("allowed");
    } finally {
      cleanup();
    }
  });
});
