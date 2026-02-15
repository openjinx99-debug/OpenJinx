import { describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "../types/messages.js";
import { subscribeStream, emitStreamEvent, hasStreamSubscribers } from "./streaming.js";

describe("subscribeStream", () => {
  it("registers a callback and returns an unsubscribe function", () => {
    const callback = vi.fn();
    const unsub = subscribeStream("session-a", callback);

    const event: ChatEvent = { type: "delta", text: "hello" };
    emitStreamEvent("session-a", event);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(event);

    unsub();
  });

  it("unsubscribe removes the callback", () => {
    const callback = vi.fn();
    const unsub = subscribeStream("session-b", callback);

    unsub();

    emitStreamEvent("session-b", { type: "delta", text: "test" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("supports multiple callbacks for the same session", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = subscribeStream("session-c", cb1);
    const unsub2 = subscribeStream("session-c", cb2);

    emitStreamEvent("session-c", { type: "delta", text: "multi" });

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();

    unsub1();
    unsub2();
  });

  it("cleans up the session entry when last subscriber leaves", () => {
    const cb = vi.fn();
    const unsub = subscribeStream("session-d", cb);

    expect(hasStreamSubscribers("session-d")).toBe(true);

    unsub();

    expect(hasStreamSubscribers("session-d")).toBe(false);
  });
});

describe("emitStreamEvent", () => {
  it("does nothing when no subscribers exist for the session", () => {
    // Should not throw
    expect(() => emitStreamEvent("no-such-session", { type: "delta", text: "lost" })).not.toThrow();
  });

  it("does not deliver events to other sessions", () => {
    const cb = vi.fn();
    const unsub = subscribeStream("session-e", cb);

    emitStreamEvent("session-other", { type: "delta", text: "wrong session" });

    expect(cb).not.toHaveBeenCalled();

    unsub();
  });

  it("continues delivering if one callback throws", () => {
    const failing = vi.fn(() => {
      throw new Error("boom");
    });
    const succeeding = vi.fn();

    const unsub1 = subscribeStream("session-f", failing);
    const unsub2 = subscribeStream("session-f", succeeding);

    emitStreamEvent("session-f", { type: "final", text: "done" });

    expect(failing).toHaveBeenCalledOnce();
    expect(succeeding).toHaveBeenCalledOnce();

    unsub1();
    unsub2();
  });
});

describe("hasStreamSubscribers", () => {
  it("returns false for unknown session", () => {
    expect(hasStreamSubscribers("unknown-session")).toBe(false);
  });

  it("returns true when session has subscribers", () => {
    const unsub = subscribeStream("session-g", vi.fn());
    expect(hasStreamSubscribers("session-g")).toBe(true);
    unsub();
  });

  it("returns false after all subscribers unsubscribe", () => {
    const unsub1 = subscribeStream("session-h", vi.fn());
    const unsub2 = subscribeStream("session-h", vi.fn());

    unsub1();
    expect(hasStreamSubscribers("session-h")).toBe(true);

    unsub2();
    expect(hasStreamSubscribers("session-h")).toBe(false);
  });
});
