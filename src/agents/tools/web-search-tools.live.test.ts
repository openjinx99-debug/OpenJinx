/**
 * Live test: Web Search Tool → OpenRouter → Perplexity Sonar.
 * Makes real API calls — requires OPENROUTER_API_KEY environment variable.
 *
 * Run: cd jinx && pnpm test:live
 * Or:  cd jinx && OPENROUTER_API_KEY=sk-or-... npx vitest run -c vitest.live.config.ts src/agents/tools/web-search-tools.live.test.ts
 *
 * These tests intentionally query for recent/real-time information that an LLM
 * would NOT know from training data alone — that's the whole point of web search.
 *
 * This test costs a small amount per run (~$0.01 per search).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { clearSearchCache, getWebSearchToolDefinitions } from "./web-search-tools.js";

const apiKey = process.env.OPENROUTER_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

function findTool(ctx: Parameters<typeof getWebSearchToolDefinitions>[0] = {}) {
  const tools = getWebSearchToolDefinitions(ctx);
  const tool = tools.find((t) => t.name === "web_search");
  if (!tool) {
    throw new Error("web_search tool not found");
  }
  return tool;
}

type SearchResult = {
  query: string;
  provider: string;
  model: string;
  tookMs: number;
  content: string;
  citations: string[];
  cached?: boolean;
};

describeIf("web_search live (OpenRouter/Perplexity)", () => {
  beforeEach(() => {
    clearSearchCache();
  });

  // ── Core: real-time info an LLM wouldn't have ─────────────────────

  it("fetches today's news that an LLM cannot know from training data", async () => {
    const tool = findTool({ apiKey });
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const result = (await tool.execute({
      query: `top technology news today ${today}`,
    })) as SearchResult;

    // Should return a substantive, real-time answer
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.citations.length).toBeGreaterThan(0);

    // Citations should be valid URLs
    for (const url of result.citations) {
      expect(url).toMatch(/^https?:\/\//);
    }

    // Structural fields
    expect(result.provider).toBe("perplexity");
    expect(result.model).toBe("perplexity/sonar-pro");
    expect(result.tookMs).toBeGreaterThan(0);
    expect(result.tookMs).toBeLessThan(30_000);
    expect(result.cached).toBeUndefined();
  }, 30_000);

  it("retrieves current stock market or financial data", async () => {
    const tool = findTool({ apiKey });
    const result = (await tool.execute({
      query: "NVIDIA stock price today February 2026",
    })) as SearchResult;

    expect(result.content.length).toBeGreaterThan(50);
    expect(result.content.toLowerCase()).toMatch(/nvda|nvidia/);
    expect(result.citations.length).toBeGreaterThan(0);
  }, 30_000);

  it("finds recent software releases beyond training cutoff", async () => {
    const tool = findTool({ apiKey });
    const result = (await tool.execute({
      query: "Node.js latest release version 2026",
    })) as SearchResult;

    expect(result.content.length).toBeGreaterThan(50);
    expect(result.content.toLowerCase()).toMatch(/node|release|version/);
    expect(result.citations.length).toBeGreaterThan(0);
  }, 30_000);

  // ── Caching: second identical query should be instant ─────────────

  it("caches results — second identical query returns instantly without API call", async () => {
    const tool = findTool({ apiKey });
    const query = "latest SpaceX launch February 2026";

    const first = (await tool.execute({ query })) as SearchResult;
    expect(first.cached).toBeUndefined();
    expect(first.content.length).toBeGreaterThan(50);

    const second = (await tool.execute({ query })) as SearchResult;
    expect(second.cached).toBe(true);
    expect(second.content).toBe(first.content);
    expect(second.citations).toEqual(first.citations);
  }, 30_000);

  // ── Alternative model ─────────────────────────────────────────────

  it("works with perplexity/sonar (non-pro) model", async () => {
    const tool = findTool({ apiKey, model: "perplexity/sonar" });
    const result = (await tool.execute({
      query: "who won the most recent Grammy awards 2026",
    })) as SearchResult;

    expect(result.model).toBe("perplexity/sonar");
    expect(result.content.length).toBeGreaterThan(50);
    expect(result.citations.length).toBeGreaterThan(0);
  }, 30_000);
});
