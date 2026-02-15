import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFetchCache, getWebFetchToolDefinitions } from "./web-fetch-tools.js";

function findTool(ctx: Parameters<typeof getWebFetchToolDefinitions>[0] = {}) {
  const tools = getWebFetchToolDefinitions(ctx);
  const tool = tools.find((t) => t.name === "web_fetch");
  if (!tool) {
    throw new Error("web_fetch tool not found");
  }
  return tool;
}

function mockFetchResponse(body: string, headers: Record<string, string> = {}, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({
      "content-type": "text/html",
      ...headers,
    }),
    text: () => Promise.resolve(body),
  });
}

describe("web-fetch-tools", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearFetchCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches HTML and converts to text", async () => {
    const html = `<html>
      <head><title>Test Page</title></head>
      <body>
        <h1>Hello World</h1>
        <p>This is a <strong>test</strong> page.</p>
      </body>
    </html>`;

    globalThis.fetch = mockFetchResponse(html);
    const tool = findTool();
    const result = (await tool.execute({ url: "https://example.com" })) as Record<string, unknown>;

    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("Test Page");
    expect(result.text).toContain("# Hello World");
    expect(result.text).toContain("This is a test page.");
    expect(result.truncated).toBe(false);
    expect(result.contentType).toContain("text/html");
  });

  it("handles JSON responses", async () => {
    const json = JSON.stringify({ key: "value", nested: { a: 1 } });
    globalThis.fetch = mockFetchResponse(json, { "content-type": "application/json" });

    const tool = findTool();
    const result = (await tool.execute({ url: "https://api.example.com/data" })) as Record<
      string,
      unknown
    >;

    expect(result.text).toContain('"key": "value"');
    expect(result.contentType).toContain("application/json");
  });

  it("truncates long content", async () => {
    const longText = "x".repeat(1000);
    globalThis.fetch = mockFetchResponse(longText, { "content-type": "text/plain" });

    const tool = findTool();
    const result = (await tool.execute({ url: "https://example.com", max_chars: 100 })) as Record<
      string,
      unknown
    >;

    expect(result.truncated).toBe(true);
    // Content is wrapped in untrusted content markers (~500 chars overhead)
    expect((result.text as string).length).toBeLessThan(800);
    expect(result.text).toContain("[... truncated]");
    expect(result.text).toContain("EXTERNAL_UNTRUSTED_CONTENT");
  });

  it("returns cached result on second fetch", async () => {
    const html = "<html><body><p>Cached content</p></body></html>";
    const mockFn = mockFetchResponse(html);
    globalThis.fetch = mockFn;

    const tool = findTool();
    await tool.execute({ url: "https://example.com/cached" });
    const result = (await tool.execute({ url: "https://example.com/cached" })) as Record<
      string,
      unknown
    >;

    expect(result.cached).toBe(true);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("rejects empty URL", async () => {
    const tool = findTool();
    const result = (await tool.execute({ url: "" })) as Record<string, unknown>;
    expect(result.error).toContain("empty");
  });

  it("rejects invalid URL", async () => {
    const tool = findTool();
    const result = (await tool.execute({ url: "not-a-url" })) as Record<string, unknown>;
    expect(result.error).toContain("Invalid URL");
  });

  it("rejects non-http URL", async () => {
    const tool = findTool();
    const result = (await tool.execute({ url: "ftp://example.com/file" })) as Record<
      string,
      unknown
    >;
    expect(result.error).toContain("Invalid URL");
  });

  it("handles HTTP error responses", async () => {
    globalThis.fetch = mockFetchResponse("Not Found", {}, 404);
    const tool = findTool();
    const result = (await tool.execute({ url: "https://example.com/missing" })) as Record<
      string,
      unknown
    >;
    expect(result.error).toContain("404");
  });

  it("strips script and style tags from HTML", async () => {
    const html = `<html>
      <head><style>.foo { color: red; }</style></head>
      <body>
        <p>Visible content</p>
        <script>alert('hidden')</script>
      </body>
    </html>`;

    globalThis.fetch = mockFetchResponse(html);
    const tool = findTool();
    const result = (await tool.execute({ url: "https://example.com" })) as Record<string, unknown>;

    expect(result.text).toContain("Visible content");
    expect(result.text).not.toContain("alert");
    expect(result.text).not.toContain("color: red");
  });

  it("follows redirects up to the limit", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({
          ok: false,
          status: 302,
          statusText: "Found",
          headers: new Headers({ location: `https://example.com/redirect-${callCount}` }),
          text: () => Promise.resolve(""),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
        text: () => Promise.resolve("Final destination"),
      });
    });

    const tool = findTool();
    const result = (await tool.execute({ url: "https://example.com/start" })) as Record<
      string,
      unknown
    >;

    expect(result.text).toContain("Final destination");
    expect(result.url).toBe("https://example.com/redirect-2");
  });

  it("handles network errors gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const tool = findTool();
    const result = (await tool.execute({ url: "https://unreachable.example.com" })) as Record<
      string,
      unknown
    >;

    expect(result.error).toContain("Network error");
  });
});
