import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramStreamWriter } from "./streaming.js";

// Mock send module — include all exports used by streaming.ts
vi.mock("./send.js", () => ({
  sendMessageTelegram: vi.fn().mockResolvedValue(1),
  fetchWithRetry: vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
  PARSE_ERR_RE: /can't parse entities|parse entities|find end of the entity/i,
  getRateLimitWaitMs: vi.fn().mockReturnValue(0),
  setRateLimit: vi.fn(),
  extractRetryAfter: vi.fn().mockReturnValue(30),
}));

// Mock format to pass through
vi.mock("./format.js", () => ({
  markdownToTelegramHtml: (text: string) => text,
  markdownToTelegramChunks: (text: string) => [{ html: text, plainLength: text.length }],
}));

let sendMock: ReturnType<typeof vi.fn>;
const fetchSpy = vi.fn();

beforeEach(async () => {
  const mod = await import("./send.js");
  sendMock = vi.mocked(mod.sendMessageTelegram);
  // Reset both call counts AND implementations to default
  sendMock.mockReset();
  sendMock.mockResolvedValue(1);

  // Mock global fetch for editMessageText calls (used by editMessageFinal/editMessageStreaming)
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TelegramStreamWriter", () => {
  it("sends a single message when finalize is called before any timeout fires", async () => {
    const writer = new TelegramStreamWriter("token", 123);

    writer.sendDelta("Hello world");
    await writer.finalize();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      botToken: "token",
      chatId: 123,
      text: "Hello world",
    });
  });

  it("does not produce duplicate messages when timeout fires before finalize", async () => {
    // Simulate sendMessageTelegram taking some time (async fetch)
    let resolveSend!: (value: number) => void;
    sendMock.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveSend = resolve;
        }),
    );

    const writer = new TelegramStreamWriter("token", 123);
    writer.sendDelta("Hello");

    // Let the setTimeout(0) fire — this starts sendInitial() with a slow fetch
    await new Promise((resolve) => setTimeout(resolve, 10));

    // sendInitial is in-flight but hasn't resolved yet.
    // Now finalize is called (simulating the "final" event arriving).
    const finalizePromise = writer.finalize();

    // Resolve the in-flight send
    resolveSend(42);
    await finalizePromise;

    // sendMessageTelegram should have been called exactly once (by the timeout).
    // finalize() should have awaited the in-flight op and then seen messageId is set.
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("edits the message on finalize when timeout already completed send", async () => {
    sendMock.mockResolvedValue(99);

    const writer = new TelegramStreamWriter("token", 123);
    writer.sendDelta("Part 1");

    // Let the timeout fire and complete (sendInitial resolves immediately)
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Add more text, then finalize
    writer.sendDelta(" Part 2");
    await writer.finalize();

    // Initial message sent once via sendMessageTelegram
    expect(sendMock).toHaveBeenCalledTimes(1);
    // Edit should have been called via fetch (editMessageText)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(callUrl).toContain("editMessageText");
  });

  it("accumulates all deltas in the buffer", async () => {
    const writer = new TelegramStreamWriter("token", 123);

    writer.sendDelta("Hello ");
    writer.sendDelta("world ");
    writer.sendDelta("!");
    await writer.finalize();

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ text: "Hello world !" }));
  });
});
