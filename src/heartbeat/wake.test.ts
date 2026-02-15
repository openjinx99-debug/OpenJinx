import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import type { HeartbeatReason } from "../types/heartbeat.js";
import type { WakeResult } from "./wake.js";
import { requestHeartbeatNow, onHeartbeatWake, cancelAllWakes } from "./wake.js";

describe("requestHeartbeatNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cancelAllWakes();
  });

  afterEach(() => {
    cancelAllWakes();
    vi.useRealTimers();
  });

  it("invokes the registered wake callback after coalesce delay", async () => {
    const callback = vi
      .fn<(agentId: string, reason: HeartbeatReason) => Promise<WakeResult>>()
      .mockResolvedValue({ status: "ok" });
    onHeartbeatWake(callback);

    requestHeartbeatNow("agent-1");

    expect(callback).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith("agent-1", "manual");
  });

  it("coalesces multiple rapid requests for the same agent", async () => {
    const callback = vi
      .fn<(agentId: string, reason: HeartbeatReason) => Promise<WakeResult>>()
      .mockResolvedValue({ status: "ok" });
    onHeartbeatWake(callback);

    requestHeartbeatNow("agent-1");
    requestHeartbeatNow("agent-1");
    requestHeartbeatNow("agent-1");

    await vi.advanceTimersByTimeAsync(250);

    expect(callback).toHaveBeenCalledOnce();
  });

  it("handles separate agents independently", async () => {
    const callback = vi
      .fn<(agentId: string, reason: HeartbeatReason) => Promise<WakeResult>>()
      .mockResolvedValue({ status: "ok" });
    onHeartbeatWake(callback);

    requestHeartbeatNow("agent-1");
    requestHeartbeatNow("agent-2");

    await vi.advanceTimersByTimeAsync(250);

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledWith("agent-1", "manual");
    expect(callback).toHaveBeenCalledWith("agent-2", "manual");
  });

  it("does not throw when no callback is registered", async () => {
    onHeartbeatWake(
      undefined as unknown as (agentId: string, reason: HeartbeatReason) => Promise<WakeResult>,
    );

    requestHeartbeatNow("agent-1");
    await vi.advanceTimersByTimeAsync(250);
  });

  it("retries on lane-busy result", async () => {
    let callCount = 0;
    const callback = vi.fn<(agentId: string, reason: HeartbeatReason) => Promise<WakeResult>>(
      async () => {
        callCount++;
        if (callCount <= 2) {
          return { status: "skipped", reason: "lane-busy" };
        }
        return { status: "ok" };
      },
    );
    onHeartbeatWake(callback);

    requestHeartbeatNow("agent-1");

    // Initial coalesce delay (250ms)
    await vi.advanceTimersByTimeAsync(250);
    expect(callback).toHaveBeenCalledTimes(1);

    // First retry after 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(2);

    // Second retry after another 1000ms — should succeed
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(3);

    // No more retries after success
    await vi.advanceTimersByTimeAsync(5000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("retries on callback error", async () => {
    let callCount = 0;
    const callback = vi.fn<(agentId: string, reason: HeartbeatReason) => Promise<WakeResult>>(
      async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("callback failed");
        }
        return { status: "ok" };
      },
    );
    onHeartbeatWake(callback);

    requestHeartbeatNow("agent-1");

    // Initial coalesce delay
    await vi.advanceTimersByTimeAsync(250);
    expect(callback).toHaveBeenCalledTimes(1);

    // Retry after error
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(2);

    // No more retries after success
    await vi.advanceTimersByTimeAsync(5000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("does not retry on success", async () => {
    const callback = vi
      .fn<(agentId: string, reason: HeartbeatReason) => Promise<WakeResult>>()
      .mockResolvedValue({ status: "ok" });
    onHeartbeatWake(callback);

    requestHeartbeatNow("agent-1");
    await vi.advanceTimersByTimeAsync(250);

    expect(callback).toHaveBeenCalledOnce();

    // Wait long enough that retries would have fired
    await vi.advanceTimersByTimeAsync(10_000);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("stops after max retries (5)", async () => {
    const callback = vi
      .fn<(agentId: string, reason: HeartbeatReason) => Promise<WakeResult>>()
      .mockResolvedValue({ status: "skipped", reason: "lane-busy" });
    onHeartbeatWake(callback);

    requestHeartbeatNow("agent-1");

    // Initial call
    await vi.advanceTimersByTimeAsync(250);
    expect(callback).toHaveBeenCalledTimes(1);

    // 5 retries (1000ms each)
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(callback).toHaveBeenCalledTimes(6); // 1 initial + 5 retries

    // Should not retry further
    await vi.advanceTimersByTimeAsync(10_000);
    expect(callback).toHaveBeenCalledTimes(6);
  });
});

describe("cancelAllWakes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelAllWakes();
    vi.useRealTimers();
  });

  it("cancels pending wake requests", async () => {
    const callback = vi
      .fn<(agentId: string, reason: HeartbeatReason) => Promise<WakeResult>>()
      .mockResolvedValue({ status: "ok" });
    onHeartbeatWake(callback);

    requestHeartbeatNow("agent-1");
    cancelAllWakes();

    await vi.advanceTimersByTimeAsync(500);

    expect(callback).not.toHaveBeenCalled();
  });
});
