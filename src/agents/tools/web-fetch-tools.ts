import type { AgentToolDefinition } from "../../providers/types.js";
import { createLogger } from "../../infra/logger.js";
import { validateUrlForSSRF, wrapUntrustedContent } from "../../infra/security.js";
import {
  type CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  withTimeout,
  writeCache,
} from "./web-shared.js";

const logger = createLogger("web-fetch");

const DEFAULT_MAX_CHARS = 50_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Jinx/1.0 (AI Assistant)";

export interface WebFetchToolContext {
  timeoutSeconds?: number;
  cacheTtlMinutes?: number;
}

type FetchResult = {
  url: string;
  title?: string;
  text: string;
  contentType: string;
  truncated: boolean;
  length: number;
  cached?: boolean;
};

const fetchCache = new Map<string, CacheEntry<FetchResult>>();

/** Strip HTML tags and convert to readable plain text. */
function htmlToText(html: string): { text: string; title?: string } {
  let title: string | undefined;

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = decodeHtmlEntities(titleMatch[1].trim());
  }

  let text = html;

  // Remove script, style, nav, footer, header elements entirely
  text = text.replace(/<(script|style|nav|footer|header|noscript|svg)\b[\s\S]*?<\/\1>/gi, "");

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Convert structured elements BEFORE stripping block tags

  // Convert headers (must run before block-to-newline conversion)
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    const clean = content.replace(/<[^>]*>/g, "").trim();
    return "\n" + "#".repeat(Number(level)) + " " + clean + "\n";
  });

  // Convert code blocks (must run before tag stripping)
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, content) => {
    const clean = content.replace(/<[^>]*>/g, "");
    return "\n```\n" + decodeHtmlEntities(clean) + "\n```\n";
  });
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, content) => {
    return "`" + content.replace(/<[^>]*>/g, "") + "`";
  });

  // Convert links to [text](url) format
  text = text.replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, linkText) => {
    const clean = linkText.replace(/<[^>]*>/g, "").trim();
    return clean ? `[${clean}](${href})` : "";
  });

  // Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
    const clean = content.replace(/<[^>]*>/g, "").trim();
    return "- " + clean + "\n";
  });

  // Convert remaining block elements to newlines
  text = text.replace(/<\/(p|div|li|tr|blockquote|section|article)>/gi, "\n");
  text = text.replace(/<(br|hr)\s*\/?>/gi, "\n");

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return { text, title };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/g, " ");
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function getWebFetchToolDefinitions(ctx: WebFetchToolContext = {}): AgentToolDefinition[] {
  const timeoutSeconds = ctx.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const cacheTtlMs = (ctx.cacheTtlMinutes ?? DEFAULT_CACHE_TTL_MINUTES) * 60_000;

  return [
    {
      name: "web_fetch",
      description:
        "Fetch and read content from a specific URL. Returns the page content converted to readable text. Use this when you need to read a specific web page, documentation, article, or API response. For general web search, use web_search instead.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch (http or https).",
          },
          max_chars: {
            type: "number",
            description: `Maximum characters to return (default: ${DEFAULT_MAX_CHARS}).`,
          },
        },
        required: ["url"],
      },
      execute: async (input) => {
        const { url, max_chars } = input as { url: string; max_chars?: number };
        const maxChars = max_chars ?? DEFAULT_MAX_CHARS;

        if (!url || !url.trim()) {
          return { error: "URL cannot be empty." };
        }

        if (!isValidUrl(url)) {
          return { error: `Invalid URL: ${url}. Only http and https URLs are supported.` };
        }

        // SSRF protection: block private/reserved IP ranges
        const ssrfBlock = await validateUrlForSSRF(url);
        if (ssrfBlock) {
          return { error: ssrfBlock };
        }

        const cacheKey = normalizeCacheKey(`${url}:${maxChars}`);
        const cached = readCache(fetchCache, cacheKey);
        if (cached) {
          return { ...cached.value, cached: true };
        }

        try {
          let currentUrl = url;
          let response: Response | undefined;

          // Follow redirects manually to track final URL
          for (let i = 0; i <= MAX_REDIRECTS; i++) {
            response = await fetch(currentUrl, {
              headers: {
                "User-Agent": USER_AGENT,
                Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*",
              },
              redirect: "manual",
              signal: withTimeout(undefined, timeoutSeconds * 1000),
            });

            if (response.status >= 300 && response.status < 400) {
              const location = response.headers.get("location");
              if (!location) {
                break;
              }
              currentUrl = new URL(location, currentUrl).href;
              if (i === MAX_REDIRECTS) {
                return { error: `Too many redirects (max ${MAX_REDIRECTS}).` };
              }
              // Validate redirect target for SSRF
              const redirectBlock = await validateUrlForSSRF(currentUrl);
              if (redirectBlock) {
                return { error: `Redirect blocked: ${redirectBlock}` };
              }
              continue;
            }
            break;
          }

          if (!response) {
            return { error: "No response received." };
          }

          if (!response.ok) {
            return { error: `HTTP ${response.status}: ${response.statusText}` };
          }

          const contentType = response.headers.get("content-type") ?? "unknown";
          const body = await response.text();

          let text: string;
          let title: string | undefined;

          if (contentType.includes("json")) {
            // Pretty-print JSON
            try {
              text = JSON.stringify(JSON.parse(body), null, 2);
            } catch {
              text = body;
            }
          } else if (contentType.includes("html")) {
            const converted = htmlToText(body);
            text = converted.text;
            title = converted.title;
          } else {
            // Plain text or other
            text = body;
          }

          const truncated = text.length > maxChars;
          if (truncated) {
            text = text.slice(0, maxChars) + "\n\n[... truncated]";
          }

          // Wrap fetched content as untrusted external content
          text = wrapUntrustedContent(text, "web_fetch", { url: currentUrl });

          const result: FetchResult = {
            url: currentUrl,
            title,
            text,
            contentType,
            truncated,
            length: text.length,
          };

          writeCache(fetchCache, cacheKey, result, cacheTtlMs);
          logger.debug(`Fetched ${currentUrl} (${text.length} chars)`);

          return result;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { error: `Request timed out after ${timeoutSeconds}s.` };
          }
          return { error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },
  ];
}

/** Exposed for testing — clears the in-memory fetch cache. */
export function clearFetchCache(): void {
  fetchCache.clear();
}
