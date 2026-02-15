import { describe, expect, it, vi } from "vitest";
import type { HeartbeatEvent } from "../types/heartbeat.js";
import { onHeartbeatEvent, emitHeartbeatEvent } from "./events.js";

function makeEvent(overrides: Partial<HeartbeatEvent> = {}): HeartbeatEvent {
  return {
    type: "heartbeat",
    agentId: "agent-1",
    timestamp: Date.now(),
    hasContent: false,
    wasOk: true,
    durationMs: 100,
    ...overrides,
  };
}

describe("onHeartbeatEvent", () => {
  // Each test file runs in its own fork so the module-level listeners array
  // starts fresh, but we still clean up via the returned unsubscribe function.

  it("subscribes a listener and returns an unsubscribe function", () => {
    const listener = vi.fn();
    const unsubscribe = onHeartbeatEvent(listener);

    const event = makeEvent();
    emitHeartbeatEvent(event);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);

    unsubscribe();
  });

  it("unsubscribe removes the listener", () => {
    const listener = vi.fn();
    const unsubscribe = onHeartbeatEvent(listener);

    unsubscribe();

    emitHeartbeatEvent(makeEvent());
    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple listeners", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = onHeartbeatEvent(listener1);
    const unsub2 = onHeartbeatEvent(listener2);

    emitHeartbeatEvent(makeEvent());

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();

    unsub1();
    unsub2();
  });
});

describe("emitHeartbeatEvent", () => {
  it("does not throw when there are no listeners", () => {
    expect(() => emitHeartbeatEvent(makeEvent())).not.toThrow();
  });

  it("continues to notify other listeners if one throws", () => {
    const failingListener = vi.fn(() => {
      throw new Error("listener error");
    });
    const succeedingListener = vi.fn();

    const unsub1 = onHeartbeatEvent(failingListener);
    const unsub2 = onHeartbeatEvent(succeedingListener);

    emitHeartbeatEvent(makeEvent());

    expect(failingListener).toHaveBeenCalledOnce();
    expect(succeedingListener).toHaveBeenCalledOnce();

    unsub1();
    unsub2();
  });

  it("passes the exact event object to all listeners", () => {
    const listener = vi.fn();
    const unsub = onHeartbeatEvent(listener);

    const event = makeEvent({ agentId: "special-agent", hasContent: true, text: "Alert!" });
    emitHeartbeatEvent(event);

    expect(listener).toHaveBeenCalledWith(event);
    expect(listener.mock.calls[0][0].agentId).toBe("special-agent");
    expect(listener.mock.calls[0][0].text).toBe("Alert!");

    unsub();
  });
});
