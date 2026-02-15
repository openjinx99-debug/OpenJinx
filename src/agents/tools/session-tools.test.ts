import { describe, expect, it, vi } from "vitest";
import type { SessionEntry, SessionStore } from "../../types/sessions.js";
import { getSessionToolDefinitions } from "./session-tools.js";

function createMockSessionStore(entries: Record<string, SessionEntry>): SessionStore {
  const map = new Map(Object.entries(entries));
  return {
    get: (key) => map.get(key),
    set: (key, entry) => map.set(key, entry),
    delete: (key) => map.delete(key),
    list: () => [...map.values()],
    save: vi.fn(),
    load: vi.fn(),
  };
}

function createMockSession(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: "test-id",
    sessionKey: "test-key",
    agentId: "default",
    channel: "terminal",
    createdAt: Date.now() - 7_200_000, // 2h ago
    lastActiveAt: Date.now(),
    turnCount: 12,
    transcriptPath: "/tmp/transcript.jsonl",
    totalInputTokens: 15234,
    totalOutputTokens: 8721,
    contextTokens: 0,
    locked: false,
    ...overrides,
  };
}

describe("getSessionToolDefinitions", () => {
  it("returns a session_status tool", () => {
    const sessions = createMockSessionStore({});
    const tools = getSessionToolDefinitions({ sessionKey: "test", sessions, timezone: "UTC" });

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("session_status");
  });

  it("session_status returns time, turn count, and tokens", async () => {
    const session = createMockSession();
    const sessions = createMockSessionStore({ "test-key": session });
    const tools = getSessionToolDefinitions({
      sessionKey: "test-key",
      sessions,
      timezone: "UTC",
    });

    const result = (await tools[0].execute({})) as string;

    expect(result).toContain("🕒 Time:");
    expect(result).toContain("UTC");
    expect(result).toContain("📊 Session: 12 turns");
    expect(result).toContain("2h ago");
    expect(result).toContain("💬 Tokens:");
    expect(result).toContain("15,234 in");
    expect(result).toContain("8,721 out");
  });

  it("handles missing session gracefully", async () => {
    const sessions = createMockSessionStore({});
    const tools = getSessionToolDefinitions({
      sessionKey: "nonexistent",
      sessions,
      timezone: "UTC",
    });

    const result = (await tools[0].execute({})) as string;

    expect(result).toContain("🕒 Time:");
    expect(result).toContain("Session: not found");
  });

  it("handles newly created session with zero turns", async () => {
    const session = createMockSession({
      createdAt: Date.now() - 500, // 500ms ago
      turnCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
    const sessions = createMockSessionStore({ "new-key": session });
    const tools = getSessionToolDefinitions({
      sessionKey: "new-key",
      sessions,
      timezone: "UTC",
    });

    const result = (await tools[0].execute({})) as string;

    expect(result).toContain("0 turns");
    expect(result).toContain("just now");
    expect(result).toContain("0 in / 0 out");
  });

  it("uses configured timezone", async () => {
    const session = createMockSession();
    const sessions = createMockSessionStore({ "test-key": session });
    const tools = getSessionToolDefinitions({
      sessionKey: "test-key",
      sessions,
      timezone: "America/New_York",
    });

    const result = (await tools[0].execute({})) as string;

    expect(result).toContain("America/New_York");
  });
});
