import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import { createGatewayClient } from "./client.js";

let wss: WebSocketServer;
let port: number;

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0 });
    wss.on("listening", () => {
      const addr = wss.address();
      port = typeof addr === "object" ? addr.port : 0;
      resolve();
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    for (const client of wss.clients) {
      client.close();
    }
    wss.close(() => resolve());
  });
}

describe("createGatewayClient", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startServer();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await stopServer();
  });

  it("connects to the gateway", async () => {
    const client = createGatewayClient(`ws://127.0.0.1:${port}`);
    await client.connect();
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it("sends and receives messages", async () => {
    // Echo server
    wss.on("connection", (ws) => {
      ws.on("message", (data) => {
        ws.send(data.toString());
      });
    });

    const client = createGatewayClient(`ws://127.0.0.1:${port}`);
    await client.connect();

    const received = new Promise<unknown>((resolve) => {
      client.onMessage((msg) => resolve(msg));
    });

    client.send({ type: "ping" } as never);

    const msg = await received;
    expect(msg).toEqual({ type: "ping" });
    client.disconnect();
  });

  it("does not reconnect after intentional disconnect", async () => {
    const client = createGatewayClient(`ws://127.0.0.1:${port}`);
    await client.connect();
    expect(client.connected).toBe(true);

    client.disconnect();
    expect(client.connected).toBe(false);

    // Advance well past reconnect delay
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.connected).toBe(false);
  });

  it("reconnects after unexpected close", async () => {
    const client = createGatewayClient(`ws://127.0.0.1:${port}`);
    await client.connect();
    expect(client.connected).toBe(true);

    // Server forcibly closes all connections
    for (const ws of wss.clients) {
      ws.close();
    }

    // Wait for close event + reconnect delay (1s base)
    await vi.advanceTimersByTimeAsync(1500);

    // Client should have reconnected
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it("removes message handler on unsubscribe", async () => {
    const client = createGatewayClient(`ws://127.0.0.1:${port}`);
    await client.connect();

    const received: unknown[] = [];
    const unsub = client.onMessage((msg) => received.push(msg));

    unsub();

    wss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "test" }));
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(received).toHaveLength(0);
    client.disconnect();
  });

  it("rejects connect() on error", async () => {
    // Point to a port nothing is listening on
    await stopServer();
    const client = createGatewayClient("ws://127.0.0.1:1");
    await expect(client.connect()).rejects.toThrow();
    expect(client.connected).toBe(false);
    client.disconnect();
    // Restart server for afterEach cleanup
    await startServer();
  });
});
