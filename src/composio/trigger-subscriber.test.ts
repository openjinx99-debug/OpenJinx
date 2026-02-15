import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemEventQueue } from "../types/events.js";
import { startTriggerSubscriber } from "./trigger-subscriber.js";

// ── Mock the Composio SDK ────────────────────────────────────────────────

const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock("@composio/core", () => ({
  Composio: class MockComposio {
    triggers = {
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    };
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────

function createMockQueue(): SystemEventQueue {
  const queues = new Map<string, Array<{ text: string }>>();
  return {
    enqueue: vi.fn((text: string, sessionKey: string) => {
      const q = queues.get(sessionKey) ?? [];
      q.push({ text });
      queues.set(sessionKey, q);
    }),
    peek: vi.fn((sessionKey: string) => queues.get(sessionKey) ?? []),
    drain: vi.fn((sessionKey: string) => {
      const events = queues.get(sessionKey) ?? [];
      queues.delete(sessionKey);
      return events;
    }),
    count: vi.fn((sessionKey: string) => queues.get(sessionKey)?.length ?? 0),
  };
}

function baseDeps(overrides?: Partial<Parameters<typeof startTriggerSubscriber>[0]>) {
  return {
    eventQueue: createMockQueue(),
    defaultAgentId: "default",
    apiKey: "test-key",
    userId: "test-user",
    timeoutSeconds: 60,
    requestHeartbeatNow: vi.fn(),
    ...overrides,
  };
}

describe("trigger-subscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribe.mockResolvedValue(undefined);
    mockUnsubscribe.mockResolvedValue(undefined);
  });

  it("calls triggers.subscribe on start", async () => {
    const deps = baseDeps();
    await startTriggerSubscriber(deps);

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith(expect.any(Function));
  });

  it("enqueues event with [Trigger: SLUG] prefix on callback", async () => {
    const deps = baseDeps();
    await startTriggerSubscriber(deps);

    // Extract the callback that was passed to subscribe
    const callback = mockSubscribe.mock.calls[0][0];
    callback({
      triggerSlug: "LINEAR_ISSUE_CREATED",
      payload: { title: "Fix bug", priority: "high" },
    });

    expect(deps.eventQueue.enqueue).toHaveBeenCalledWith(
      expect.stringContaining("[Trigger: LINEAR_ISSUE_CREATED]"),
      "heartbeat:default",
      "composio-trigger",
    );
  });

  it("calls requestHeartbeatNow with composio-trigger reason", async () => {
    const deps = baseDeps();
    await startTriggerSubscriber(deps);

    const callback = mockSubscribe.mock.calls[0][0];
    callback({ triggerSlug: "GITHUB_COMMIT_EVENT", payload: {} });

    expect(deps.requestHeartbeatNow).toHaveBeenCalledWith("default", "composio-trigger");
  });

  it("calls triggers.unsubscribe on stop", async () => {
    const deps = baseDeps();
    const stop = await startTriggerSubscriber(deps);
    await stop();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("handles connection errors gracefully", async () => {
    mockSubscribe.mockRejectedValue(new Error("Pusher connection failed"));

    const deps = baseDeps();
    const stop = await startTriggerSubscriber(deps);

    // Should return a no-op stop function, not throw
    await expect(stop()).resolves.toBeUndefined();
  });

  it("formats trigger payload into summary text", async () => {
    const deps = baseDeps();
    await startTriggerSubscriber(deps);

    const callback = mockSubscribe.mock.calls[0][0];
    callback({
      triggerSlug: "LINEAR_ISSUE_CREATED",
      payload: { title: "New feature", status: "Todo" },
    });

    const enqueueCall = (deps.eventQueue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(enqueueCall).toContain("title=New feature");
    expect(enqueueCall).toContain("status=Todo");
  });
});
