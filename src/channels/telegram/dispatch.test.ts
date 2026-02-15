import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MsgContext } from "../../types/messages.js";
import type { SessionStore } from "../../types/sessions.js";
import { createTestConfig } from "../../__test__/config.js";

vi.mock("../../agents/runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({
    text: "reply",
    messages: [],
    usage: { inputTokens: 10, outputTokens: 5 },
    durationMs: 50,
  }),
}));

vi.mock("../../heartbeat/wake.js", () => ({
  requestHeartbeatNow: vi.fn(),
}));

vi.mock("../../sessions/transcript.js", () => ({
  resolveTranscriptPath: vi.fn().mockReturnValue("/tmp/transcript.jsonl"),
}));

vi.mock("../../pipeline/streaming.js", () => ({
  emitStreamEvent: vi.fn(),
}));

vi.mock("../../pipeline/lanes.js", () => ({
  getSessionLane: vi.fn().mockReturnValue({
    enqueue: vi.fn(async (fn: () => Promise<void>) => fn()),
  }),
}));

function createMockSessionStore(): SessionStore {
  const map = new Map();
  return {
    get: vi.fn((key: string) => map.get(key)),
    set: vi.fn((key: string, entry: unknown) => map.set(key, entry)),
    delete: vi.fn((key: string) => map.delete(key)),
    list: vi.fn(() => [...map.values()]),
    save: vi.fn(),
    load: vi.fn(),
  };
}

const makeTelegramCtx = (overrides?: Partial<MsgContext>): MsgContext => ({
  messageId: "1",
  sessionKey: "telegram:dm:100",
  text: "hello",
  channel: "telegram",
  accountId: "100",
  senderId: "100",
  senderName: "Test User",
  isGroup: false,
  isCommand: false,
  agentId: "default",
  timestamp: Date.now(),
  ...overrides,
});

describe("dispatchTelegramMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches allowed DM messages", async () => {
    const { runAgent } = await import("../../agents/runner.js");
    const { dispatchTelegramMessage } = await import("./dispatch.js");

    const config = createTestConfig({
      channels: { telegram: { enabled: true, dmPolicy: "open" } },
    });
    const sessions = createMockSessionStore();

    const result = await dispatchTelegramMessage(makeTelegramCtx(), { config, sessions });

    expect(runAgent).toHaveBeenCalled();
    // Returns a reply payload (text delivered via streaming)
    expect(result).toBeDefined();
  });

  it("rejects messages when dmPolicy is disabled", async () => {
    const { runAgent } = await import("../../agents/runner.js");
    const { dispatchTelegramMessage } = await import("./dispatch.js");

    const config = createTestConfig({
      channels: { telegram: { enabled: true, dmPolicy: "disabled" } },
    });
    const sessions = createMockSessionStore();

    const result = await dispatchTelegramMessage(makeTelegramCtx(), { config, sessions });

    expect(runAgent).not.toHaveBeenCalled();
    expect(result.text).toBe("Access denied.");
  });

  it("rejects group messages when no allowedChatIds configured", async () => {
    const { runAgent } = await import("../../agents/runner.js");
    const { dispatchTelegramMessage } = await import("./dispatch.js");

    const config = createTestConfig({
      channels: { telegram: { enabled: true, dmPolicy: "open" } },
    });
    const sessions = createMockSessionStore();

    const result = await dispatchTelegramMessage(
      makeTelegramCtx({ isGroup: true, groupId: "-999" }),
      { config, sessions },
    );

    expect(runAgent).not.toHaveBeenCalled();
    expect(result.text).toBe("Access denied.");
  });

  it("allows group messages with matching allowedChatIds", async () => {
    const { runAgent } = await import("../../agents/runner.js");
    const { dispatchTelegramMessage } = await import("./dispatch.js");

    const config = createTestConfig({
      channels: { telegram: { enabled: true, allowedChatIds: [-999] } },
    });
    const sessions = createMockSessionStore();

    const result = await dispatchTelegramMessage(
      makeTelegramCtx({ isGroup: true, groupId: "-999" }),
      { config, sessions },
    );

    expect(runAgent).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
