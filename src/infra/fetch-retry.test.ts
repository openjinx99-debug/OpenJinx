import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithRetry } from "./fetch-retry.js";

describe("fetchWithRetry", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(...responses: Array<{ status: number; ok: boolean }>) {
    let callIndex = 0;
    globalThis.fetch = vi.fn(async () => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return new Response(null, { status: resp.status }) as Response;
    }) as typeof fetch;
  }

  it("returns immediately on success", async () => {
    mockFetch({ status: 200, ok: true });
    const resp = await fetchWithRetry("https://example.com", {});
    expect(resp.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("returns immediately on 4xx (non-retryable)", async () => {
    mockFetch({ status: 400, ok: false });
    const resp = await fetchWithRetry("https://example.com", {});
    expect(resp.status).toBe(400);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("retries on 429 and succeeds", async () => {
    mockFetch({ status: 429, ok: false }, { status: 200, ok: true });
    const resp = await fetchWithRetry("https://example.com", {}, 1);
    expect(resp.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 and succeeds", async () => {
    mockFetch({ status: 500, ok: false }, { status: 200, ok: true });
    const resp = await fetchWithRetry("https://example.com", {}, 1);
    expect(resp.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns last response after exhausting retries", async () => {
    mockFetch({ status: 500, ok: false });
    const resp = await fetchWithRetry("https://example.com", {}, 2);
    expect(resp.status).toBe(500);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
