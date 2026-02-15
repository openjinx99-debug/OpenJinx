import { describe, it, expect, vi } from "vitest";
import type { SessionEntry, SessionStore } from "../../types/sessions.js";
import { getChannelToolDefinitions, type ChannelToolDeps } from "./channel-tools.js";

function createMockSessionStore(entries: SessionEntry[] = []): SessionStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockReturnValue(entries),
    save: vi.fn(),
    load: vi.fn(),
  };
}

function makeSession(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: "sess-1",
    sessionKey: "terminal:dm:local",
    agentId: "default",
    channel: "terminal",
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    turnCount: 5,
    transcriptPath: "/tmp/t.jsonl",
    totalInputTokens: 100,
    totalOutputTokens: 50,
    contextTokens: 0,
    locked: false,
    ...overrides,
  };
}

describe("getChannelToolDefinitions", () => {
  it("returns empty array when no deps are provided", () => {
    const tools = getChannelToolDefinitions();
    expect(tools).toEqual([]);
  });

  it("returns empty array when deps is undefined", () => {
    const tools = getChannelToolDefinitions(undefined);
    expect(tools).toEqual([]);
  });

  it("returns tools when deps are provided", () => {
    const deps: ChannelToolDeps = {
      sessions: createMockSessionStore(),
      send: vi.fn(),
    };

    const tools = getChannelToolDefinitions(deps);
    const names = tools.map((t) => t.name);

    expect(names).toContain("message");
    expect(names).toContain("sessions_send");
    expect(names).toContain("sessions_list");
  });

  it("message tool calls send callback with correct args", async () => {
    const sendFn = vi.fn().mockResolvedValue(true);
    const deps: ChannelToolDeps = {
      sessions: createMockSessionStore(),
      send: sendFn,
    };

    const tools = getChannelToolDefinitions(deps);
    const messageTool = tools.find((t) => t.name === "message")!;

    const result = await messageTool.execute({
      channel: "telegram",
      to: "12345",
      text: "hello",
    });

    expect(sendFn).toHaveBeenCalledWith("telegram", "12345", "hello");
    expect(result).toEqual({ sent: true });
  });

  it("sessions_list tool returns session summaries", async () => {
    const sessions = [
      makeSession({ sessionKey: "terminal:dm:local", channel: "terminal", turnCount: 5 }),
      makeSession({ sessionKey: "telegram:dm:123", channel: "telegram", turnCount: 3 }),
    ];
    const deps: ChannelToolDeps = {
      sessions: createMockSessionStore(sessions),
      send: vi.fn(),
    };

    const tools = getChannelToolDefinitions(deps);
    const listTool = tools.find((t) => t.name === "sessions_list")!;

    const result = (await listTool.execute({})) as {
      sessions: Array<{ sessionKey: string; channel: string }>;
    };

    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0].sessionKey).toBe("terminal:dm:local");
  });

  it("sessions_send tool sends to session peer via channel", async () => {
    const sendFn = vi.fn().mockResolvedValue(true);
    const session = makeSession({
      sessionKey: "telegram:dm:123",
      channel: "telegram",
      peerId: "123",
    });
    const store = createMockSessionStore([session]);
    vi.mocked(store.get).mockImplementation((key: string) =>
      key === "telegram:dm:123" ? session : undefined,
    );

    const deps: ChannelToolDeps = { sessions: store, send: sendFn };
    const tools = getChannelToolDefinitions(deps);
    const sendTool = tools.find((t) => t.name === "sessions_send")!;

    const result = (await sendTool.execute({
      session_key: "telegram:dm:123",
      text: "hello from agent",
    })) as { sent: boolean };

    expect(sendFn).toHaveBeenCalledWith("telegram", "123", "hello from agent");
    expect(result.sent).toBe(true);
  });

  it("sessions_send tool prefers groupId over peerId", async () => {
    const sendFn = vi.fn().mockResolvedValue(true);
    const session = makeSession({
      sessionKey: "whatsapp:group:g1",
      channel: "whatsapp",
      peerId: "user1",
      groupId: "g1",
    });
    const store = createMockSessionStore([session]);
    vi.mocked(store.get).mockImplementation((key: string) =>
      key === "whatsapp:group:g1" ? session : undefined,
    );

    const deps: ChannelToolDeps = { sessions: store, send: sendFn };
    const tools = getChannelToolDefinitions(deps);
    const sendTool = tools.find((t) => t.name === "sessions_send")!;

    await sendTool.execute({ session_key: "whatsapp:group:g1", text: "hi group" });

    expect(sendFn).toHaveBeenCalledWith("whatsapp", "g1", "hi group");
  });

  it("sessions_send tool returns error for unknown session", async () => {
    const store = createMockSessionStore();
    vi.mocked(store.get).mockReturnValue(undefined);
    const deps: ChannelToolDeps = { sessions: store, send: vi.fn() };
    const tools = getChannelToolDefinitions(deps);
    const sendTool = tools.find((t) => t.name === "sessions_send")!;

    const result = (await sendTool.execute({
      session_key: "nonexistent",
      text: "hi",
    })) as { sent: boolean; message: string };

    expect(result.sent).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("sessions_list tool filters by channel", async () => {
    const sessions = [
      makeSession({ sessionKey: "terminal:dm:local", channel: "terminal" }),
      makeSession({ sessionKey: "telegram:dm:123", channel: "telegram" }),
    ];
    const deps: ChannelToolDeps = {
      sessions: createMockSessionStore(sessions),
      send: vi.fn(),
    };

    const tools = getChannelToolDefinitions(deps);
    const listTool = tools.find((t) => t.name === "sessions_list")!;

    const result = (await listTool.execute({ channel: "telegram" })) as {
      sessions: Array<{ sessionKey: string; channel: string }>;
    };

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].channel).toBe("telegram");
  });
});
