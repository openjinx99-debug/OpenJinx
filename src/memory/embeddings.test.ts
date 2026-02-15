import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createOpenAIEmbeddingProvider } from "./embeddings.js";

const originalFetch = globalThis.fetch;

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createOpenAIEmbeddingProvider", () => {
  it("returns empty array for empty input", async () => {
    const provider = createOpenAIEmbeddingProvider({ apiKey: "sk-test" });
    const result = await provider.embed([]);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends correct request to OpenAI API", async () => {
    const fakeEmbedding = [0.1, 0.2, 0.3];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: fakeEmbedding, index: 0 }],
      }),
    });

    const provider = createOpenAIEmbeddingProvider({
      apiKey: "sk-test-key",
      model: "text-embedding-3-small",
    });
    const result = await provider.embed(["hello world"]);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({
      Authorization: "Bearer sk-test-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toEqual(["hello world"]);

    expect(result).toEqual([fakeEmbedding]);
  });

  it("handles multiple texts in a single batch", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [0.1], index: 0 },
          { embedding: [0.2], index: 1 },
          { embedding: [0.3], index: 2 },
        ],
      }),
    });

    const provider = createOpenAIEmbeddingProvider({ apiKey: "sk-test" });
    const result = await provider.embed(["a", "b", "c"]);

    expect(result).toEqual([[0.1], [0.2], [0.3]]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("sorts results by index to match input order", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [0.3], index: 2 },
          { embedding: [0.1], index: 0 },
          { embedding: [0.2], index: 1 },
        ],
      }),
    });

    const provider = createOpenAIEmbeddingProvider({ apiKey: "sk-test" });
    const result = await provider.embed(["a", "b", "c"]);

    expect(result).toEqual([[0.1], [0.2], [0.3]]);
  });

  it("throws on API error response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Invalid API key"}}',
    });

    const provider = createOpenAIEmbeddingProvider({ apiKey: "sk-bad" });
    await expect(provider.embed(["test"])).rejects.toThrow("OpenAI embeddings API error 401");
  });

  it("defaults model to text-embedding-3-small", () => {
    const provider = createOpenAIEmbeddingProvider({ apiKey: "sk-test" });
    expect(provider.model).toBe("text-embedding-3-small");
    expect(provider.dimensions).toBe(1536);
  });

  it("uses custom model when specified", () => {
    const provider = createOpenAIEmbeddingProvider({
      apiKey: "sk-test",
      model: "text-embedding-3-large",
    });
    expect(provider.model).toBe("text-embedding-3-large");
  });
});
