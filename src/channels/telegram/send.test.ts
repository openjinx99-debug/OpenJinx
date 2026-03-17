import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithRetry,
  sendMessageTelegram,
  sendTypingIndicator,
  startTypingLoop,
  setRateLimit,
  getRateLimitWaitMs,
  extractRetryAfter,
} from "./send.js";

function mockTelegramResponse(result: unknown, ok = true): Response {
  return new Response(JSON.stringify({ ok, result }), {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sendMessageTelegram", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns message_id from successful response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockTelegramResponse({ message_id: 42 }));

    const id = await sendMessageTelegram({
      botToken: "tok",
      chatId: 123,
      text: "hello",
    });

    expect(id).toBe(42);
  });

  it("sends correct payload to Telegram API", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockTelegramResponse({ message_id: 1 }));

    await sendMessageTelegram({
      botToken: "my-token",
      chatId: 999,
      text: "test message",
      parseMode: "Markdown",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botmy-token/sendMessage");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      chat_id: 999,
      text: "test message",
      parse_mode: "Markdown",
    });
  });

  it("defaults parseMode to HTML", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockTelegramResponse({ message_id: 1 }));

    await sendMessageTelegram({ botToken: "tok", chatId: 1, text: "hi" });

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.parse_mode).toBe("HTML");
  });

  it("throws on non-ok HTTP status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockTelegramResponse({ description: "Bad Request" }, false),
    );

    await expect(sendMessageTelegram({ botToken: "tok", chatId: 1, text: "hi" })).rejects.toThrow(
      "Telegram sendMessage failed: 400",
    );
  });

  it("retries as plain text when Telegram rejects HTML entities", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // First call: 400 with parse entity error
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" }),
        {
          status: 400,
        },
      ),
    );
    // Retry: succeeds
    fetchSpy.mockResolvedValueOnce(mockTelegramResponse({ message_id: 77 }));

    const id = await sendMessageTelegram({ botToken: "tok", chatId: 1, text: "<bad>html" });
    expect(id).toBe(77);

    // Retry should omit parse_mode
    const retryBody = JSON.parse(fetchSpy.mock.calls[1]![1]?.body as string);
    expect(retryBody.parse_mode).toBeUndefined();
  });

  it("does not retry on non-parse 400 errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), {
        status: 400,
      }),
    );

    await expect(sendMessageTelegram({ botToken: "tok", chatId: 1, text: "hi" })).rejects.toThrow(
      "Telegram sendMessage failed: 400",
    );
  });

  it("throws when both HTML and plain text retry fail", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, description: "can't parse entities" }), {
        status: 400,
      }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, description: "other error" }), { status: 500 }),
    );

    await expect(sendMessageTelegram({ botToken: "tok", chatId: 1, text: "hi" })).rejects.toThrow(
      "Telegram sendMessage failed: 500",
    );
  });
});

describe("sendTypingIndicator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends typing action to the correct endpoint", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await sendTypingIndicator("tok", 123);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottok/sendChatAction");
    expect(JSON.parse(init?.body as string)).toEqual({
      chat_id: 123,
      action: "typing",
    });
  });

  it("does not throw on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 400 }));

    await expect(sendTypingIndicator("tok", 1)).resolves.toBeUndefined();
  });
});

describe("startTypingLoop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("sends typing immediately and returns a stop function", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const stop = startTypingLoop("tok", 123);

    // Wait for the immediate fire-and-forget fetch to settle
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());

    stop();
    expect(typeof stop).toBe("function");
  });
});

describe("setRateLimit — cap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caps absurd retry_after to 300s", () => {
    // Use a unique token so we don't pollute other tests
    const token = "cap-test-token";
    setRateLimit(token, 55_000);
    const waitMs = getRateLimitWaitMs(token);
    // Should be ≤ 300s (300_000ms) + small timing margin
    expect(waitMs).toBeLessThanOrEqual(301_000);
    expect(waitMs).toBeGreaterThan(0);
  });

  it("passes through reasonable retry_after unchanged", () => {
    const token = "reasonable-test-token";
    setRateLimit(token, 30);
    const waitMs = getRateLimitWaitMs(token);
    expect(waitMs).toBeLessThanOrEqual(31_000);
    expect(waitMs).toBeGreaterThan(0);
  });
});

describe("extractRetryAfter", () => {
  it("extracts retry_after from Telegram response", () => {
    const body = JSON.stringify({ parameters: { retry_after: 120 } });
    expect(extractRetryAfter(body)).toBe(120);
  });

  it("defaults to 30 on missing field", () => {
    expect(extractRetryAfter("{}")).toBe(30);
  });

  it("defaults to 30 on invalid JSON", () => {
    expect(extractRetryAfter("not json")).toBe(30);
  });
});

describe("fetchWithRetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns immediately on 200", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const resp = await fetchWithRetry("https://example.com", { method: "POST" }, 2);
    expect(resp.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("retries on 5xx and succeeds on 2nd attempt", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response("error", { status: 500 }));
    fetchSpy.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const resp = await fetchWithRetry("https://example.com", { method: "POST" }, 2);
    expect(resp.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 (rate limit)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    fetchSpy.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const resp = await fetchWithRetry("https://example.com", { method: "POST" }, 2);
    expect(resp.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 400", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }));

    const resp = await fetchWithRetry("https://example.com", { method: "POST" }, 2);
    expect(resp.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("returns last response when retries exhausted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(new Response("error", { status: 500 }));

    const resp = await fetchWithRetry("https://example.com", { method: "POST" }, 1);
    expect(resp.status).toBe(500);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});
