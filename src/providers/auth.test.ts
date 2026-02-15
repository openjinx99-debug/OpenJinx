import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveAuth, hasAuth } from "./auth.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => {
    throw new Error("no keychain");
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveAuth", () => {
  it("returns oauth when CLAUDE_CODE_OAUTH_TOKEN is set", () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-token-123");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const auth = resolveAuth();
    expect(auth).toEqual({ mode: "oauth", token: "oauth-token-123" });
  });

  it("returns api-key when only ANTHROPIC_API_KEY is set", () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-xyz");
    const auth = resolveAuth();
    expect(auth).toEqual({ mode: "api-key", key: "sk-ant-xyz" });
  });

  it("prefers oauth over api-key", () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-tok");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-xyz");
    const auth = resolveAuth();
    expect(auth.mode).toBe("oauth");
  });

  it("throws when no auth is available", () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => resolveAuth()).toThrow("No Claude authentication found");
  });

  it("reads from macOS Keychain as fallback", async () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const { execSync } = await import("node:child_process");
    const mockExec = vi.mocked(execSync);
    mockExec.mockReturnValueOnce(
      JSON.stringify({ claudeAiOauth: { accessToken: "keychain-token" } }),
    );

    const auth = resolveAuth();
    expect(auth).toEqual({ mode: "oauth", token: "keychain-token" });
  });
});

describe("hasAuth", () => {
  it("returns true with oauth token", () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "tok");
    expect(hasAuth()).toBe(true);
  });

  it("returns true with api key", () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    expect(hasAuth()).toBe(true);
  });

  it("returns false with no auth", () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(hasAuth()).toBe(false);
  });
});
