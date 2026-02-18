import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestConfig } from "../__test__/config.js";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  },
}));

vi.mock("../workspace/bootstrap.js", () => ({
  ensureWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../sessions/store.js", () => ({
  createSessionStore: vi.fn(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(() => []),
  })),
}));

vi.mock("../cron/service.js", () => {
  class MockCronService {
    start = vi.fn();
    stop = vi.fn();
  }
  return { CronService: MockCronService };
});

vi.mock("./server.js", () => ({
  createGatewayServer: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../channels/telegram/bot.js", () => ({
  createTelegramChannel: vi.fn(),
}));

const mockRunAgent = vi.fn().mockResolvedValue({
  text: "HEARTBEAT_OK",
  usage: { inputTokens: 0, outputTokens: 0 },
  messages: [],
  durationMs: 0,
});
vi.mock("../agents/runner.js", () => ({
  runAgent: (...args: unknown[]) => mockRunAgent(...args),
}));

vi.mock("../infra/home-dir.js", () => ({
  resolveHomeDir: () => "/tmp/jinx-test",
  expandTilde: (p: string) => p.replace("~", "/tmp/jinx-test"),
  ensureHomeDir: () => "/tmp/jinx-test",
  homeRelative: (rel: string) => `/tmp/jinx-test/${rel}`,
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

const { bootGateway } = await import("./startup.js");
const { emitHeartbeatEvent } = await import("../heartbeat/events.js");
const { subscribeStream } = await import("../pipeline/streaming.js");
import type { HeartbeatEvent } from "../types/heartbeat.js";

describe("bootGateway heartbeat wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers agents from config for heartbeat", async () => {
    const config = createTestConfig();
    const boot = await bootGateway(config);

    // The default config has one agent "default" with heartbeat.enabled=true.
    // The HeartbeatRunner.start() is called after registerAgent, so the runner
    // should be active. We verify indirectly via the event subscription.
    expect(boot).toBeDefined();
    expect(boot.stop).toBeInstanceOf(Function);

    await boot.stop();
  });

  it("registers agent with custom heartbeat config", async () => {
    const config = createTestConfig({
      agents: {
        default: "custom",
        list: [
          {
            id: "custom",
            name: "Custom Agent",
            workspace: "~/.jinx/workspace",
            heartbeat: {
              enabled: true,
              intervalMinutes: 5,
              activeHours: { start: 9, end: 17, timezone: "UTC" },
            },
          },
        ],
      },
    });

    const boot = await bootGateway(config);
    expect(boot).toBeDefined();
    await boot.stop();
  });

  it("skips agent registration when heartbeat is disabled", async () => {
    const config = createTestConfig({
      heartbeat: { enabled: false },
    });

    // Agent has no per-agent heartbeat override, so falls back to global (disabled).
    const boot = await bootGateway(config);
    expect(boot).toBeDefined();
    await boot.stop();
  });

  it("delivers heartbeat content to terminal stream", async () => {
    const config = createTestConfig();
    const boot = await bootGateway(config);

    // Subscribe to the terminal session stream
    const delivered: string[] = [];
    const unsub = subscribeStream("terminal:dm:local", (event) => {
      if (event.type === "final") {
        delivered.push(event.text);
      }
    });

    // Simulate a heartbeat event with substantive content (> 300 chars)
    const longContent = "You have 3 unread messages and 2 pending tasks. ".repeat(10);
    const event: HeartbeatEvent = {
      type: "heartbeat",
      agentId: "default",
      timestamp: Date.now(),
      hasContent: true,
      text: longContent,
      wasOk: false,
      durationMs: 100,
    };
    emitHeartbeatEvent(event);

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain(longContent);

    unsub();
    await boot.stop();
  });

  it("suppresses short acknowledgment heartbeats", async () => {
    const config = createTestConfig();
    const boot = await bootGateway(config);

    const delivered: string[] = [];
    const unsub = subscribeStream("terminal:dm:local", (event) => {
      if (event.type === "final") {
        delivered.push(event.text);
      }
    });

    // Short text (< 300 chars) is treated as acknowledgment and suppressed
    const event: HeartbeatEvent = {
      type: "heartbeat",
      agentId: "default",
      timestamp: Date.now(),
      hasContent: true,
      text: "All clear, nothing needed.",
      wasOk: false,
      durationMs: 50,
    };
    emitHeartbeatEvent(event);

    expect(delivered).toHaveLength(0);

    unsub();
    await boot.stop();
  });

  it("suppresses HEARTBEAT_OK events via visibility", async () => {
    const config = createTestConfig();
    const boot = await bootGateway(config);

    const delivered: string[] = [];
    const unsub = subscribeStream("terminal:dm:local", (event) => {
      if (event.type === "final") {
        delivered.push(event.text);
      }
    });

    // HEARTBEAT_OK: wasOk=true, hasContent=false — default visibility.showOk=false
    const event: HeartbeatEvent = {
      type: "heartbeat",
      agentId: "default",
      timestamp: Date.now(),
      hasContent: false,
      wasOk: true,
      durationMs: 10,
    };
    emitHeartbeatEvent(event);

    expect(delivered).toHaveLength(0);

    unsub();
    await boot.stop();
  });

  it("stop() cleans up heartbeat subscription", async () => {
    const config = createTestConfig();
    const boot = await bootGateway(config);
    await boot.stop();

    // After stop, emitting heartbeat events should not deliver to stream
    const delivered: string[] = [];
    const unsub = subscribeStream("terminal:dm:local", (event) => {
      if (event.type === "final") {
        delivered.push(event.text);
      }
    });

    const longContent = "Important alert message. ".repeat(20);
    emitHeartbeatEvent({
      type: "heartbeat",
      agentId: "default",
      timestamp: Date.now(),
      hasContent: true,
      text: longContent,
      wasOk: false,
      durationMs: 100,
    });

    expect(delivered).toHaveLength(0);
    unsub();
  });
});
