import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChannelPlugin } from "../types/channels.js";
import type { HeartbeatEvent, HeartbeatVisibility } from "../types/heartbeat.js";
import type { SessionEntry, SessionStore } from "../types/sessions.js";
import { deliverHeartbeatEvent } from "./delivery.js";

// Mock the modules we call
vi.mock("../delivery/deliver.js", () => ({
  deliverOutboundPayloads: vi.fn(async () => ({
    channel: "telegram",
    to: "123",
    textChunks: 1,
    mediaItems: 0,
    success: true,
  })),
}));

vi.mock("../pipeline/streaming.js", () => ({
  emitStreamEvent: vi.fn(),
}));

import { deliverOutboundPayloads } from "../delivery/deliver.js";
import { emitStreamEvent } from "../pipeline/streaming.js";

const mockedDeliver = vi.mocked(deliverOutboundPayloads);
const mockedEmit = vi.mocked(emitStreamEvent);

function makeEvent(overrides?: Partial<HeartbeatEvent>): HeartbeatEvent {
  return {
    type: "heartbeat",
    agentId: "agent-1",
    timestamp: Date.now(),
    hasContent: true,
    text: "Weather alert: A major storm system is approaching your area within the next 2 hours. Current conditions show rapidly dropping barometric pressure and increasing wind speeds. You should consider bringing all outdoor items inside, securing any loose structures, and ensuring you have emergency supplies readily available. Expected rainfall totals are 3-5 inches with potential for localized flooding in low-lying areas. Stay tuned for further updates.",
    wasOk: false,
    durationMs: 500,
    ...overrides,
  };
}

function makeVisibility(overrides?: Partial<HeartbeatVisibility>): HeartbeatVisibility {
  return {
    showOk: false,
    showAlerts: true,
    useIndicator: true,
    ...overrides,
  };
}

function makeChannel(overrides?: Partial<ChannelPlugin>): ChannelPlugin {
  return {
    id: "telegram",
    name: "Telegram",
    capabilities: {
      markdown: true,
      images: true,
      audio: false,
      video: false,
      documents: true,
      reactions: false,
      editing: true,
      streaming: true,
      maxTextLength: 4096,
    },
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send: vi.fn(async () => undefined),
    isReady: vi.fn(() => true),
    ...overrides,
  };
}

function makeSessionStore(sessions: Record<string, SessionEntry>): SessionStore {
  const map = new Map(Object.entries(sessions));
  return {
    get: (key) => map.get(key),
    set: (key, entry) => map.set(key, entry),
    delete: (key) => map.delete(key),
    list: () => [...map.values()],
    save: vi.fn(async () => {}),
    load: vi.fn(async () => {}),
  };
}

function makeSessionEntry(overrides?: Partial<SessionEntry>): SessionEntry {
  return {
    sessionId: "sess-1",
    sessionKey: "heartbeat:agent-1",
    agentId: "agent-1",
    channel: "telegram",
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    turnCount: 5,
    transcriptPath: "/tmp/test.jsonl",
    peerId: "123",
    totalInputTokens: 0,
    totalOutputTokens: 0,
    contextTokens: 0,
    locked: false,
    ...overrides,
  };
}

describe("deliverHeartbeatEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delivers to terminal when no session exists", () => {
    const sessions = makeSessionStore({});
    const deps = {
      sessions,
      visibility: makeVisibility(),
      getChannel: vi.fn(() => undefined),
    };

    deliverHeartbeatEvent(makeEvent(), deps);

    expect(mockedEmit).toHaveBeenCalledWith("terminal:dm:local", {
      type: "final",
      text: expect.stringContaining("💓"),
    });
  });

  it("delivers to terminal when session channel is terminal", () => {
    const session = makeSessionEntry({ channel: "terminal" });
    const sessions = makeSessionStore({ "heartbeat:agent-1": session });
    const terminalChannel = makeChannel({ id: "terminal", isReady: vi.fn(() => true) });
    const deps = {
      sessions,
      visibility: makeVisibility(),
      getChannel: vi.fn((name: string) => (name === "terminal" ? terminalChannel : undefined)),
    };

    deliverHeartbeatEvent(makeEvent(), deps);

    // Terminal channel exists and is ready, so it goes through deliverOutboundPayloads
    expect(mockedDeliver).toHaveBeenCalled();
  });

  it("delivers to telegram when session has telegram channel", async () => {
    const session = makeSessionEntry({ channel: "telegram", peerId: "456" });
    const sessions = makeSessionStore({ "heartbeat:agent-1": session });
    const telegramChannel = makeChannel({ id: "telegram" });
    const deps = {
      sessions,
      visibility: makeVisibility(),
      getChannel: vi.fn((name: string) => (name === "telegram" ? telegramChannel : undefined)),
    };

    deliverHeartbeatEvent(makeEvent(), deps);

    // Wait for async delivery
    await vi.waitFor(() => {
      expect(mockedDeliver).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ channel: "telegram" }),
        }),
      );
    });
  });

  it("falls back to terminal when channel is not ready", () => {
    const session = makeSessionEntry({ channel: "telegram" });
    const sessions = makeSessionStore({ "heartbeat:agent-1": session });
    const telegramChannel = makeChannel({ id: "telegram", isReady: vi.fn(() => false) });
    const deps = {
      sessions,
      visibility: makeVisibility(),
      getChannel: vi.fn((name: string) => (name === "telegram" ? telegramChannel : undefined)),
    };

    deliverHeartbeatEvent(makeEvent(), deps);

    expect(mockedDeliver).not.toHaveBeenCalled();
    expect(mockedEmit).toHaveBeenCalledWith("terminal:dm:local", expect.any(Object));
  });

  it("falls back to terminal on delivery failure", async () => {
    mockedDeliver.mockResolvedValueOnce({
      channel: "telegram",
      to: "123",
      textChunks: 0,
      mediaItems: 0,
      success: false,
      error: "Connection refused",
    });

    const session = makeSessionEntry({ channel: "telegram" });
    const sessions = makeSessionStore({ "heartbeat:agent-1": session });
    const telegramChannel = makeChannel({ id: "telegram" });
    const deps = {
      sessions,
      visibility: makeVisibility(),
      getChannel: vi.fn((name: string) => (name === "telegram" ? telegramChannel : undefined)),
    };

    deliverHeartbeatEvent(makeEvent(), deps);

    await vi.waitFor(() => {
      expect(mockedEmit).toHaveBeenCalledWith("terminal:dm:local", expect.any(Object));
    });
  });

  it("suppresses by visibility settings", () => {
    const sessions = makeSessionStore({});
    const deps = {
      sessions,
      visibility: makeVisibility({ showAlerts: false }),
      getChannel: vi.fn(() => undefined),
    };

    deliverHeartbeatEvent(makeEvent(), deps);

    expect(mockedEmit).not.toHaveBeenCalled();
    expect(mockedDeliver).not.toHaveBeenCalled();
  });

  it("suppresses acknowledgments (short text)", () => {
    const sessions = makeSessionStore({});
    const deps = {
      sessions,
      visibility: makeVisibility(),
      getChannel: vi.fn(() => undefined),
    };

    deliverHeartbeatEvent(makeEvent({ text: "All clear", hasContent: true }), deps);

    expect(mockedEmit).not.toHaveBeenCalled();
  });

  it("includes indicator prefix when useIndicator is true", () => {
    const sessions = makeSessionStore({});
    const deps = {
      sessions,
      visibility: makeVisibility({ useIndicator: true }),
      getChannel: vi.fn(() => undefined),
    };

    deliverHeartbeatEvent(makeEvent(), deps);

    expect(mockedEmit).toHaveBeenCalledWith("terminal:dm:local", {
      type: "final",
      text: expect.stringContaining("💓"),
    });
  });

  it("omits indicator prefix when useIndicator is false", () => {
    const sessions = makeSessionStore({});
    const deps = {
      sessions,
      visibility: makeVisibility({ useIndicator: false }),
      getChannel: vi.fn(() => undefined),
    };

    deliverHeartbeatEvent(makeEvent(), deps);

    const call = mockedEmit.mock.calls[0];
    expect(call[1]).toEqual({
      type: "final",
      text: expect.not.stringContaining("💓"),
    });
  });
});
