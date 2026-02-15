import type { AgentToolDefinition } from "../../providers/types.js";
import { fetchWithRetry } from "../../infra/fetch-retry.js";
import { wrapUntrustedContent } from "../../infra/security.js";
import {
  type CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  withTimeout,
  writeCache,
} from "./web-shared.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "perplexity/sonar-pro";

export interface WebSearchToolContext {
  apiKey?: string;
  model?: string;
  timeoutSeconds?: number;
  cacheTtlMinutes?: number;
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

type PerplexityResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  citations?: string[];
};

const searchCache = new Map<string, CacheEntry<SearchResult>>();

function resolveApiKey(ctx: WebSearchToolContext): string | undefined {
  return ctx.apiKey || process.env.OPENROUTER_API_KEY;
}

export function getWebSearchToolDefinitions(ctx: WebSearchToolContext): AgentToolDefinition[] {
  const model = ctx.model || DEFAULT_MODEL;
  const timeoutSeconds = ctx.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const cacheTtlMs = (ctx.cacheTtlMinutes ?? DEFAULT_CACHE_TTL_MINUTES) * 60_000;

  return [
    {
      name: "web_search",
      description:
        "Search the web using Perplexity Sonar via OpenRouter. Returns an AI-synthesized answer with citations from real-time web search. Use this when you need current information, news, or facts that may not be in your training data.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query. Be specific and concise for best results.",
          },
        },
        required: ["query"],
      },
      execute: async (input) => {
        const { query } = input as { query: string };

        if (!query || !query.trim()) {
          return { error: "Search query cannot be empty." };
        }

        const apiKey = resolveApiKey(ctx);
        if (!apiKey) {
          return {
            error:
              "No OpenRouter API key found. Set OPENROUTER_API_KEY environment variable or configure webSearch.apiKey in ~/.jinx/config.yaml.",
          };
        }

        const cacheKey = normalizeCacheKey(`${query}:${model}`);
        const cached = readCache(searchCache, cacheKey);
        if (cached) {
          return { ...cached.value, cached: true };
        }

        const startMs = Date.now();
        const endpoint = `${OPENROUTER_BASE_URL}/chat/completions`;

        const res = await fetchWithRetry(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "https://jinx.dev",
            "X-Title": "Jinx Web Search",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: query }],
          }),
          signal: withTimeout(undefined, timeoutSeconds * 1000),
        });

        if (!res.ok) {
          const detail = await readResponseText(res);
          throw new Error(`Web search failed (${res.status}): ${detail || res.statusText}`);
        }

        const data = (await res.json()) as PerplexityResponse;
        const rawContent = data.choices?.[0]?.message?.content ?? "No results found.";
        const citations = data.citations ?? [];
        // Wrap web search content as untrusted external content
        const content = wrapUntrustedContent(rawContent, "web_search");

        const result: SearchResult = {
          query,
          provider: "perplexity",
          model,
          tookMs: Date.now() - startMs,
          content,
          citations,
        };

        writeCache(searchCache, cacheKey, result, cacheTtlMs);

        return result;
      },
    },
  ];
}

/** Exposed for testing — clears the in-memory search cache. */
export function clearSearchCache(): void {
  searchCache.clear();
}
