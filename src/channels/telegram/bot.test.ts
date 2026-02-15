import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchDeps } from "../../pipeline/dispatch.js";
import { createTelegramChannel } from "./bot.js";

// Mock dispatch to isolate from the full pipeline
vi.mock("./dispatch.js", () => ({
  dispatchTelegramMessage: vi.fn().mockResolvedValue({ text: "reply" }),
}));

// Mock send to capture calls without hitting the network
vi.mock("./send.js", () => ({
  sendMessageTelegram: vi.fn().mockResolvedValue(99),
  startTypingLoop: vi.fn().mockReturnValue(() => {}),
}));

// Mock streaming module's TelegramStreamWriter with a real class
vi.mock("./streaming.js", () => {
  class MockStreamWriter {
    sendDelta = vi.fn();
    finalize = vi.fn().mockResolvedValue(undefined);
  }
  return { TelegramStreamWriter: MockStreamWriter };
});

function mockTelegramResponse(result: unknown, ok = true): Response {
  return new Response(JSON.stringify({ ok, result }), {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
}

function makeDeps(overrides?: Partial<DispatchDeps>): DispatchDeps {
  return {
    config: {
      channels: {
        telegram: {
          enabled: true,
          botToken: "test-token",
          dmPolicy: "open",
          streaming: true,
        },
      },
    } as DispatchDeps["config"],
    sessions: {} as DispatchDeps["sessions"],
    ...overrides,
  };
}

describe("createTelegramChannel", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockTelegramResponse([]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("lifecycle", () => {
    it("start() makes isReady() return true", async () => {
      const channel = createTelegramChannel(
        { enabled: true, botToken: "tok", streaming: true },
        makeDeps(),
      );

      expect(channel.isReady()).toBe(false);
      await channel.start();
      expect(channel.isReady()).toBe(true);
      await channel.stop();
    });

    it("stop() makes isReady() return false", async () => {
      const channel = createTelegramChannel(
        { enabled: true, botToken: "tok", streaming: true },
        makeDeps(),
      );

      await channel.start();
      await channel.stop();
      expect(channel.isReady()).toBe(false);
    });
  });

  describe("send()", () => {
    it("converts markdown to HTML, chunks, and sends each chunk", async () => {
      const { sendMessageTelegram } = await import("./send.js");
      const sendMock = vi.mocked(sendMessageTelegram);
      sendMock.mockResolvedValue(55);

      const channel = createTelegramChannel(
        { enabled: true, botToken: "my-token", streaming: true },
        makeDeps(),
      );

      const result = await channel.send("123", { text: "**bold** message" });

      expect(sendMock).toHaveBeenCalledWith({
        botToken: "my-token",
        chatId: 123,
        text: expect.stringContaining("<b>bold</b>"),
      });
      expect(result).toBe("55"); // stringified message_id
    });

    it("returns stringified message_id from last chunk", async () => {
      const { sendMessageTelegram } = await import("./send.js");
      const sendMock = vi.mocked(sendMessageTelegram);
      sendMock.mockResolvedValueOnce(10).mockResolvedValueOnce(11);

      const channel = createTelegramChannel(
        { enabled: true, botToken: "tok", streaming: true },
        makeDeps(),
      );

      // Create text long enough to be chunked (>4000 chars)
      const longText = "A".repeat(5000);
      const result = await channel.send("1", { text: longText });

      expect(sendMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(result).toBe("11"); // last message_id
    });

    it("returns undefined for empty text", async () => {
      const channel = createTelegramChannel(
        { enabled: true, botToken: "tok", streaming: true },
        makeDeps(),
      );

      const result = await channel.send("1", { text: "" });
      expect(result).toBeUndefined();
    });

    it("returns undefined when payload has no text", async () => {
      const channel = createTelegramChannel(
        { enabled: true, botToken: "tok", streaming: true },
        makeDeps(),
      );

      const result = await channel.send("1", {});
      expect(result).toBeUndefined();
    });
  });

  describe("capabilities", () => {
    it("exposes expected capabilities", () => {
      const channel = createTelegramChannel(
        { enabled: true, botToken: "tok", streaming: true },
        makeDeps(),
      );

      expect(channel.capabilities).toEqual({
        markdown: true,
        images: true,
        audio: true,
        video: true,
        documents: true,
        reactions: false,
        editing: true,
        streaming: true,
        maxTextLength: 4096,
      });
    });

    it("has id and name", () => {
      const channel = createTelegramChannel(
        { enabled: true, botToken: "tok", streaming: true },
        makeDeps(),
      );

      expect(channel.id).toBe("telegram");
      expect(channel.name).toBe("Telegram");
    });
  });

  describe("onStreamEvent", () => {
    it("is a no-op when no active writer exists for the session", () => {
      const channel = createTelegramChannel(
        { enabled: true, botToken: "tok", streaming: true },
        makeDeps(),
      );

      // No writer exists for this session key — should not throw
      expect(() => {
        channel.onStreamEvent!("telegram:dm:1", { type: "delta", text: "hi" });
      }).not.toThrow();
    });
  });

  describe("handleUpdate (via monitor)", () => {
    it("ignores updates without message.text", async () => {
      const { dispatchTelegramMessage } = await import("./dispatch.js");
      const dispatchMock = vi.mocked(dispatchTelegramMessage);

      vi.useFakeTimers();

      const channel = createTelegramChannel(
        { enabled: true, botToken: "tok", streaming: true },
        makeDeps(),
      );

      // Return an update with no text
      fetchSpy.mockResolvedValueOnce(
        mockTelegramResponse([
          {
            update_id: 1,
            message: {
              message_id: 1,
              chat: { id: 42, type: "private" },
              date: 1700000000,
              // no text field
            },
          },
        ]),
      );

      await channel.start();
      await vi.advanceTimersByTimeAsync(600); // trigger poll

      expect(dispatchMock).not.toHaveBeenCalled();

      await channel.stop();
      vi.useRealTimers();
    });

    it("dispatches valid text messages", async () => {
      const { dispatchTelegramMessage } = await import("./dispatch.js");
      const dispatchMock = vi.mocked(dispatchTelegramMessage);
      dispatchMock.mockClear();

      vi.useFakeTimers();

      const channel = createTelegramChannel(
        { enabled: true, botToken: "tok", streaming: true },
        makeDeps(),
      );

      fetchSpy.mockResolvedValueOnce(
        mockTelegramResponse([
          {
            update_id: 1,
            message: {
              message_id: 10,
              from: { id: 42, first_name: "Alice" },
              chat: { id: 42, type: "private" },
              text: "hello jinx",
              date: 1700000000,
            },
          },
        ]),
      );

      await channel.start();
      await vi.advanceTimersByTimeAsync(600);

      expect(dispatchMock).toHaveBeenCalledOnce();
      const ctx = dispatchMock.mock.calls[0]![0];
      expect(ctx.text).toBe("hello jinx");
      expect(ctx.channel).toBe("telegram");
      expect(ctx.senderId).toBe("42");

      await channel.stop();
      vi.useRealTimers();
    });
  });
});
