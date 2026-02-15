import { describe, expect, it, vi, afterEach } from "vitest";
import { isTruthyEnv, requireEnv, getEnv, resolveClaudeAuth } from "./env.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isTruthyEnv", () => {
  it("returns true for '1'", () => {
    vi.stubEnv("TEST_FLAG", "1");
    expect(isTruthyEnv("TEST_FLAG")).toBe(true);
  });

  it("returns true for 'true'", () => {
    vi.stubEnv("TEST_FLAG", "true");
    expect(isTruthyEnv("TEST_FLAG")).toBe(true);
  });

  it("returns true for 'yes'", () => {
    vi.stubEnv("TEST_FLAG", "yes");
    expect(isTruthyEnv("TEST_FLAG")).toBe(true);
  });

  it("returns false for unset", () => {
    vi.stubEnv("TEST_FLAG", "");
    expect(isTruthyEnv("TEST_FLAG")).toBe(false);
  });

  it("returns false for '0'", () => {
    vi.stubEnv("TEST_FLAG", "0");
    expect(isTruthyEnv("TEST_FLAG")).toBe(false);
  });
});

describe("requireEnv", () => {
  it("returns value when set", () => {
    vi.stubEnv("MY_KEY", "secret");
    expect(requireEnv("MY_KEY")).toBe("secret");
  });

  it("throws when not set", () => {
    vi.stubEnv("MY_KEY", "");
    expect(() => requireEnv("MY_KEY")).toThrow("Required environment variable");
  });
});

describe("getEnv", () => {
  it("returns value when set", () => {
    vi.stubEnv("MY_KEY", "value");
    expect(getEnv("MY_KEY")).toBe("value");
  });

  it("returns default when not set", () => {
    vi.stubEnv("MY_KEY", "");
    expect(getEnv("NONEXISTENT_KEY_XYZ", "fallback")).toBe("fallback");
  });
});

describe("resolveClaudeAuth", () => {
  it("prefers oauth token", () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-tok");
    vi.stubEnv("ANTHROPIC_API_KEY", "api-key");
    const auth = resolveClaudeAuth();
    expect(auth).toEqual({ mode: "oauth", token: "oauth-tok" });
  });

  it("falls back to api key", () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-123");
    const auth = resolveClaudeAuth();
    expect(auth).toEqual({ mode: "api-key", key: "sk-ant-123" });
  });

  it("returns undefined when no auth", () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(resolveClaudeAuth()).toBeUndefined();
  });
});
