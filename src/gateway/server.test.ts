import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import WebSocket from "ws";
import type { SessionStore } from "../types/sessions.js";
import { createTestConfig } from "../__test__/config.js";
import { createGatewayServer } from "./server.js";

vi.mock("../agents/runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({
    text: "test reply",
    messages: [],
    usage: { inputTokens: 10, outputTokens: 5 },
    durationMs: 50,
  }),
}));

vi.mock("../heartbeat/wake.js", () => ({
  requestHeartbeatNow: vi.fn(),
}));

vi.mock("../sessions/transcript.js", () => ({
  resolveTranscriptPath: vi.fn().mockReturnValue("/tmp/transcript.jsonl"),
}));

vi.mock("../pipeline/lanes.js", () => ({
  getSessionLane: vi.fn().mockReturnValue({
    enqueue: vi.fn(async (fn: () => Promise<void>) => fn()),
    running: 0,
    pending: 0,
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

let nextPort = 19980;
function getPort(): number {
  return nextPort++;
}

function connectWS(port: number, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe("Gateway WebSocket server", () => {
  let server: ReturnType<typeof createGatewayServer>;
  let port: number;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await server?.stop();
  });

  it("accepts connections and responds to health.check", async () => {
    port = getPort();
    const config = createTestConfig({ gateway: { host: "127.0.0.1", port } });
    const sessions = createMockSessionStore();
    server = createGatewayServer(config, { config, sessions });
    server.start();
    await new Promise((r) => setTimeout(r, 50));

    const ws = await connectWS(port);
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify({ type: "health.check" }));
    const resp = await msgPromise;

    expect(resp).toMatchObject({
      type: "health.status",
      ok: true,
    });

    ws.close();
  });

  it("rejects connections with wrong auth token", async () => {
    port = getPort();
    const config = createTestConfig({
      gateway: { host: "127.0.0.1", port, authToken: "valid-token" },
    });
    const sessions = createMockSessionStore();
    server = createGatewayServer(config, { config, sessions });
    server.start();
    await new Promise((r) => setTimeout(r, 50));

    await expect(connectWS(port, { Authorization: "Bearer wrong-token" })).rejects.toThrow();
  });

  it("accepts connections with correct auth token", async () => {
    port = getPort();
    const config = createTestConfig({
      gateway: { host: "127.0.0.1", port, authToken: "valid-token" },
    });
    const sessions = createMockSessionStore();
    server = createGatewayServer(config, { config, sessions });
    server.start();
    await new Promise((r) => setTimeout(r, 50));

    const ws = await connectWS(port, { Authorization: "Bearer valid-token" });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("responds to heartbeat.wake with ack", async () => {
    port = getPort();
    const config = createTestConfig({ gateway: { host: "127.0.0.1", port } });
    const sessions = createMockSessionStore();
    server = createGatewayServer(config, { config, sessions });
    server.start();
    await new Promise((r) => setTimeout(r, 50));

    const ws = await connectWS(port);
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify({ type: "heartbeat.wake", agentId: "default" }));
    const resp = await msgPromise;

    expect(resp).toEqual({ type: "heartbeat.wake.ack", agentId: "default" });

    const { requestHeartbeatNow } = await import("../heartbeat/wake.js");
    expect(requestHeartbeatNow).toHaveBeenCalledWith("default", "manual");

    ws.close();
  });

  it("ignores malformed messages", async () => {
    port = getPort();
    const config = createTestConfig({ gateway: { host: "127.0.0.1", port } });
    const sessions = createMockSessionStore();
    server = createGatewayServer(config, { config, sessions });
    server.start();
    await new Promise((r) => setTimeout(r, 50));

    const ws = await connectWS(port);

    // Send garbage — should not crash the server
    ws.send("not json at all");
    ws.send(JSON.stringify({ type: "unknown.type" }));
    ws.send(JSON.stringify({ type: "chat.send" })); // missing fields

    // Wait a bit then verify server still responds
    await new Promise((r) => setTimeout(r, 100));
    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "health.check" }));
    const resp = await msgPromise;

    expect(resp).toMatchObject({ type: "health.status", ok: true });
    ws.close();
  });
});
