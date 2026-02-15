import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSearchCache, getWebSearchToolDefinitions } from "./web-search-tools.js";

function findTool(ctx: Parameters<typeof getWebSearchToolDefinitions>[0] = {}) {
  const tools = getWebSearchToolDefinitions(ctx);
  const tool = tools.find((t) => t.name === "web_search");
  if (!tool) {
    throw new Error("web_search tool not found");
  }
  return tool;
}

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe("web-search-tools", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearSearchCache();
    vi.stubEnv("OPENROUTER_API_KEY", "");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  // ── successful search ─────────────────────────────────────────────

  it("returns formatted result for a successful search", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: "TypeScript 5.7 was released." } }],
      citations: ["https://devblogs.microsoft.com/typescript"],
    });

    const tool = findTool({ apiKey: "sk-or-test-key" });
    const result = (await tool.execute({ query: "latest TypeScript news" })) as Record<
      string,
      unknown
    >;

    expect(result.query).toBe("latest TypeScript news");
    expect(result.provider).toBe("perplexity");
    expect(result.model).toBe("perplexity/sonar-pro");
    expect(result.content).toContain("TypeScript 5.7 was released.");
    expect(result.content).toContain("EXTERNAL_UNTRUSTED_CONTENT");
    expect(result.citations).toEqual(["https://devblogs.microsoft.com/typescript"]);
    expect(result.tookMs).toBeTypeOf("number");
    expect(result.cached).toBeUndefined();
  });

  // ── caching ───────────────────────────────────────────────────────

  it("returns cached result on second call without extra fetch", async () => {
    const mockFetch = mockFetchResponse({
      choices: [{ message: { content: "cached answer" } }],
      citations: [],
    });
    globalThis.fetch = mockFetch;

    const tool = findTool({ apiKey: "sk-or-test-key" });

    const first = (await tool.execute({ query: "test caching" })) as Record<string, unknown>;
    expect(first.cached).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const second = (await tool.execute({ query: "test caching" })) as Record<string, unknown>;
    expect(second.cached).toBe(true);
    expect(second.content).toContain("cached answer");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ── missing API key ───────────────────────────────────────────────

  it("returns error when no API key is available", async () => {
    const tool = findTool({});
    const result = (await tool.execute({ query: "test" })) as { error: string };

    expect(result.error).toContain("No OpenRouter API key found");
    expect(result.error).toContain("OPENROUTER_API_KEY");
  });

  // ── API key from environment ──────────────────────────────────────

  it("uses OPENROUTER_API_KEY from environment", async () => {
    const mockFetch = mockFetchResponse({
      choices: [{ message: { content: "env key works" } }],
      citations: [],
    });
    globalThis.fetch = mockFetch;

    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-env-key");

    const tool = findTool({});
    const result = (await tool.execute({ query: "test env key" })) as Record<string, unknown>;

    expect(result.content).toContain("env key works");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(callArgs[1].headers).toHaveProperty("Authorization", "Bearer sk-or-env-key");
  });

  // ── HTTP error ────────────────────────────────────────────────────

  it("throws on non-200 response", async () => {
    globalThis.fetch = mockFetchResponse({ error: "rate limited" }, 429);

    const tool = findTool({ apiKey: "sk-or-test-key" });
    await expect(tool.execute({ query: "test error" })).rejects.toThrow("Web search failed (429)");
  });

  // ── timeout ───────────────────────────────────────────────────────

  it("aborts request on timeout", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        }),
    );

    const tool = findTool({ apiKey: "sk-or-test-key", timeoutSeconds: 0.05 });
    await expect(tool.execute({ query: "slow query" })).rejects.toThrow();
  });

  // ── empty query ───────────────────────────────────────────────────

  it("rejects empty query", async () => {
    const tool = findTool({ apiKey: "sk-or-test-key" });
    const result = (await tool.execute({ query: "" })) as { error: string };
    expect(result.error).toContain("cannot be empty");
  });

  it("rejects whitespace-only query", async () => {
    const tool = findTool({ apiKey: "sk-or-test-key" });
    const result = (await tool.execute({ query: "   " })) as { error: string };
    expect(result.error).toContain("cannot be empty");
  });

  // ── custom model ──────────────────────────────────────────────────

  it("uses custom model when specified", async () => {
    const mockFetch = mockFetchResponse({
      choices: [{ message: { content: "custom model answer" } }],
      citations: [],
    });
    globalThis.fetch = mockFetch;

    const tool = findTool({ apiKey: "sk-or-test-key", model: "perplexity/sonar" });
    const result = (await tool.execute({ query: "test model" })) as Record<string, unknown>;

    expect(result.model).toBe("perplexity/sonar");
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string) as { model: string };
    expect(body.model).toBe("perplexity/sonar");
  });

  // ── no citations ──────────────────────────────────────────────────

  it("handles response with no citations", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: "no citations here" } }],
    });

    const tool = findTool({ apiKey: "sk-or-test-key" });
    const result = (await tool.execute({ query: "test" })) as Record<string, unknown>;

    expect(result.content).toContain("no citations here");
    expect(result.citations).toEqual([]);
  });
});
