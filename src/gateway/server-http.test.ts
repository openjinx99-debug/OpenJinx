import http from "node:http";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { SessionStore } from "../types/sessions.js";
import { createTestConfig } from "../__test__/config.js";
import { createHttpServer } from "./server-http.js";

function createMockSessionStore(): SessionStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(() => []),
    save: vi.fn(),
    load: vi.fn(),
  };
}

function makeRequest(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf-8"),
          headers: res.headers,
        });
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// Use unique ports to avoid EADDRINUSE conflicts between tests
let nextPort = 19990;
function getPort(): number {
  return nextPort++;
}

describe("HTTP server – healthz", () => {
  let server: ReturnType<typeof createHttpServer>;
  let port: number;

  afterEach(async () => {
    await server?.stop();
  });

  it("responds to GET /healthz with status info", async () => {
    port = getPort();
    const config = createTestConfig({
      gateway: { http: { enabled: true, port, hooks: { enabled: true } } },
    });
    server = createHttpServer({
      config,
      sessions: createMockSessionStore(),
      startedAt: Date.now() - 1000,
    });
    server.start();
    await new Promise((r) => setTimeout(r, 50));

    const res = await makeRequest(port, "GET", "/healthz");
    expect(res.status).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.uptime).toBeGreaterThan(0);
    expect(body.sessions).toBe(0);
  });

  it("returns 404 for unknown routes", async () => {
    port = getPort();
    const config = createTestConfig({
      gateway: { http: { enabled: true, port, hooks: { enabled: true } } },
    });
    server = createHttpServer({
      config,
      sessions: createMockSessionStore(),
      startedAt: Date.now(),
    });
    server.start();
    await new Promise((r) => setTimeout(r, 50));

    const res = await makeRequest(port, "GET", "/unknown");
    expect(res.status).toBe(404);
  });
});

describe("HTTP server – hooks", () => {
  let server: ReturnType<typeof createHttpServer>;
  let port: number;

  afterEach(async () => {
    await server?.stop();
  });

  it("returns 404 for POST /hooks/ when hooks disabled", async () => {
    port = getPort();
    const config = createTestConfig({
      gateway: { http: { enabled: true, port, hooks: { enabled: false } } },
    });
    server = createHttpServer({
      config,
      sessions: createMockSessionStore(),
      startedAt: Date.now(),
    });
    server.start();
    await new Promise((r) => setTimeout(r, 50));

    const res = await makeRequest(port, "POST", "/hooks/test", "{}");
    expect(res.status).toBe(404);
  });

  it("routes POST /hooks/:path to registered webhook handler", async () => {
    port = getPort();
    const config = createTestConfig({
      gateway: { http: { enabled: true, port, hooks: { enabled: true } } },
    });
    server = createHttpServer({
      config,
      sessions: createMockSessionStore(),
      startedAt: Date.now(),
    });
    server.start();
    await new Promise((r) => setTimeout(r, 50));

    server.onWebhook(async (path, body) => {
      if (path === "test") {
        return { status: 200, body: JSON.stringify({ received: JSON.parse(body) }) };
      }
      return { status: 404, body: JSON.stringify({ error: "Not found" }) };
    });

    const res = await makeRequest(port, "POST", "/hooks/test", JSON.stringify({ hello: "world" }), {
      "Content-Type": "application/json",
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ received: { hello: "world" } });
  });

  it("enforces auth token on hooks when configured", async () => {
    port = getPort();
    const config = createTestConfig({
      gateway: {
        http: { enabled: true, port, hooks: { enabled: true, authToken: "secret-123" } },
      },
    });
    server = createHttpServer({
      config,
      sessions: createMockSessionStore(),
      startedAt: Date.now(),
    });
    server.start();
    await new Promise((r) => setTimeout(r, 50));

    server.onWebhook(async () => ({
      status: 200,
      body: JSON.stringify({ ok: true }),
    }));

    // Without auth
    const res1 = await makeRequest(port, "POST", "/hooks/test", "{}", {
      "Content-Type": "application/json",
    });
    expect(res1.status).toBe(401);

    // With wrong auth
    const res2 = await makeRequest(port, "POST", "/hooks/test", "{}", {
      "Content-Type": "application/json",
      Authorization: "Bearer wrong-token",
    });
    expect(res2.status).toBe(401);

    // With correct auth
    const res3 = await makeRequest(port, "POST", "/hooks/test", "{}", {
      "Content-Type": "application/json",
      Authorization: "Bearer secret-123",
    });
    expect(res3.status).toBe(200);
  });
});

describe("HTTP server – telegram webhook", () => {
  let server: ReturnType<typeof createHttpServer>;
  let port: number;

  afterEach(async () => {
    await server?.stop();
  });

  it("routes POST /telegram/webhook to webhook handler", async () => {
    port = getPort();
    const config = createTestConfig({
      gateway: { http: { enabled: true, port, hooks: { enabled: true } } },
    });
    server = createHttpServer({
      config,
      sessions: createMockSessionStore(),
      startedAt: Date.now(),
    });
    server.start();
    await new Promise((r) => setTimeout(r, 50));

    server.onWebhook(async (path) => {
      if (path === "telegram/webhook") {
        return { status: 200, body: JSON.stringify({ ok: true }) };
      }
      return { status: 404, body: JSON.stringify({ error: "Not found" }) };
    });

    const res = await makeRequest(
      port,
      "POST",
      "/telegram/webhook",
      JSON.stringify({ update_id: 1 }),
      { "Content-Type": "application/json" },
    );
    expect(res.status).toBe(200);
  });
});
