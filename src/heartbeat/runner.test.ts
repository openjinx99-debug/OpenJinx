import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HeartbeatReason } from "../types/heartbeat.js";
import { createTestConfig } from "../__test__/config.js";
import { clearDuplicateStore } from "./duplicate.js";
import { HeartbeatRunner } from "./runner.js";

function makeRunner(
  runTurn?: (agentId: string, prompt: string, reason: HeartbeatReason) => Promise<string>,
  preFlightCheck?: (agentId: string) => Promise<boolean>,
  isLaneBusy?: (agentId: string) => boolean,
) {
  const config = createTestConfig();
  const mockRunTurn = runTurn ?? vi.fn(async () => "HEARTBEAT_OK");
  return {
    runner: new HeartbeatRunner(config, mockRunTurn, preFlightCheck, isLaneBusy),
    runTurn: mockRunTurn,
  };
}

describe("HeartbeatRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearDuplicateStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registerAgent adds an agent", async () => {
    const { runner } = makeRunner();
    runner.registerAgent("agent-1", 60_000);
    // If the agent was registered, runOnce should not throw
    const event = await runner.runOnce("agent-1");
    expect(event.agentId).toBe("agent-1");
  });

  it("runOnce calls runTurn and returns event with content", async () => {
    const mockRunTurn = vi.fn(async () => "Hello world");
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    const event = await runner.runOnce("agent-1");

    expect(mockRunTurn).toHaveBeenCalledOnce();
    expect(event.type).toBe("heartbeat");
    expect(event.agentId).toBe("agent-1");
    expect(event.hasContent).toBe(true);
    expect(event.text).toBe("Hello world");
  });

  it("runOnce handles HEARTBEAT_OK response", async () => {
    const mockRunTurn = vi.fn(async () => "HEARTBEAT_OK");
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    const event = await runner.runOnce("agent-1");

    expect(event.wasOk).toBe(true);
    expect(event.hasContent).toBe(false);
    expect(event.text).toBeUndefined();
  });

  it("runOnce handles empty response", async () => {
    const mockRunTurn = vi.fn(async () => "");
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    const event = await runner.runOnce("agent-1");

    expect(event.hasContent).toBe(false);
    expect(event.text).toBeUndefined();
  });

  it("runOnce throws for unknown agent", async () => {
    const { runner } = makeRunner();
    await expect(runner.runOnce("unknown")).rejects.toThrow("Unknown agent: unknown");
  });

  it("start and stop manage timer", async () => {
    const mockRunTurn = vi.fn(async () => "HEARTBEAT_OK");
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    runner.start();

    // Advance time past the interval so the tick fires
    await vi.advanceTimersByTimeAsync(65_000);

    expect(mockRunTurn).toHaveBeenCalled();

    runner.stop();

    // Reset mock and advance more — should NOT fire again
    mockRunTurn.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(mockRunTurn).not.toHaveBeenCalled();
  });

  it("skips API call when preFlightCheck returns false", async () => {
    const mockRunTurn = vi.fn(async () => "HEARTBEAT_OK");
    const mockPreFlight = vi.fn(async () => false);
    const { runner } = makeRunner(mockRunTurn, mockPreFlight);
    runner.registerAgent("agent-1", 60_000);

    const event = await runner.runOnce("agent-1");

    expect(mockPreFlight).toHaveBeenCalledWith("agent-1");
    expect(mockRunTurn).not.toHaveBeenCalled();
    expect(event.wasOk).toBe(true);
    expect(event.hasContent).toBe(false);
  });

  it("runs API call when preFlightCheck returns true", async () => {
    const mockRunTurn = vi.fn(async () => "Some content");
    const mockPreFlight = vi.fn(async () => true);
    const { runner } = makeRunner(mockRunTurn, mockPreFlight);
    runner.registerAgent("agent-1", 60_000);

    const event = await runner.runOnce("agent-1");

    expect(mockPreFlight).toHaveBeenCalledWith("agent-1");
    expect(mockRunTurn).toHaveBeenCalled();
    expect(event.hasContent).toBe(true);
  });

  it("runs API call when no preFlightCheck is provided", async () => {
    const mockRunTurn = vi.fn(async () => "HEARTBEAT_OK");
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    await runner.runOnce("agent-1");

    expect(mockRunTurn).toHaveBeenCalled();
  });

  it("tick recovers from thrown error and schedules next", async () => {
    let callCount = 0;
    const mockRunTurn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("provider crash");
      }
      return "HEARTBEAT_OK";
    });
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    runner.start();

    // First tick — will throw, but should recover
    await vi.advanceTimersByTimeAsync(65_000);
    expect(mockRunTurn).toHaveBeenCalledTimes(1);

    // Second tick — should succeed (proves scheduleNext ran after error)
    await vi.advanceTimersByTimeAsync(65_000);
    expect(mockRunTurn).toHaveBeenCalledTimes(2);

    runner.stop();
  });

  it("emits failed event on executeHeartbeat error", async () => {
    const mockRunTurn = vi.fn(async () => {
      throw new Error("provider crash");
    });
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    const event = await runner.runOnce("agent-1");

    expect(event.wasOk).toBe(false);
    expect(event.hasContent).toBe(false);
  });

  it("skips heartbeat when lane is busy", async () => {
    const mockRunTurn = vi.fn(async () => "Hello world");
    const mockLaneBusy = vi.fn(() => true);
    const { runner } = makeRunner(mockRunTurn, undefined, mockLaneBusy);
    runner.registerAgent("agent-1", 60_000);

    const event = await runner.runOnce("agent-1");

    expect(mockLaneBusy).toHaveBeenCalledWith("agent-1");
    expect(mockRunTurn).not.toHaveBeenCalled();
    expect(event.hasContent).toBe(false);
    expect(event.wasOk).toBe(true);
  });

  it("runs heartbeat when lane is idle", async () => {
    const mockRunTurn = vi.fn(async () => "Hello world");
    const mockLaneBusy = vi.fn(() => false);
    const { runner } = makeRunner(mockRunTurn, undefined, mockLaneBusy);
    runner.registerAgent("agent-1", 60_000);

    const event = await runner.runOnce("agent-1");

    expect(mockLaneBusy).toHaveBeenCalledWith("agent-1");
    expect(mockRunTurn).toHaveBeenCalled();
    expect(event.hasContent).toBe(true);
  });

  it("defers to next interval when lane is busy", async () => {
    const mockRunTurn = vi.fn(async () => "HEARTBEAT_OK");
    let busy = true;
    const mockLaneBusy = vi.fn(() => busy);
    const { runner } = makeRunner(mockRunTurn, undefined, mockLaneBusy);
    runner.registerAgent("agent-1", 60_000);

    runner.start();

    // First tick — lane is busy, should skip
    await vi.advanceTimersByTimeAsync(65_000);
    expect(mockRunTurn).not.toHaveBeenCalled();

    // Free the lane, next tick should run
    busy = false;
    await vi.advanceTimersByTimeAsync(65_000);
    expect(mockRunTurn).toHaveBeenCalled();

    runner.stop();
  });

  it("works without isLaneBusy callback (backward compat)", async () => {
    const mockRunTurn = vi.fn(async () => "Some content");
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    const event = await runner.runOnce("agent-1");

    expect(mockRunTurn).toHaveBeenCalled();
    expect(event.hasContent).toBe(true);
  });

  it("tick skips agents outside active hours", async () => {
    const mockRunTurn = vi.fn(async () => "HEARTBEAT_OK");
    const { runner } = makeRunner(mockRunTurn);

    // Register with very restrictive active hours that are impossible to match:
    // active only from hour 25 to 26 (which doesn't exist, effectively always outside)
    // Use a real but restrictive window: 3am-4am UTC — fake timers default to epoch (midnight Jan 1 1970 + offset)
    // We'll set the current time to noon UTC so 3-4am is outside
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));

    runner.registerAgent("agent-1", 10_000, {
      start: 3,
      end: 4,
      timezone: "UTC",
    });

    runner.start();

    // Advance time past the interval
    await vi.advanceTimersByTimeAsync(30_000);

    // runTurn should NOT have been called because we're outside active hours (12:00 UTC, active 3-4)
    expect(mockRunTurn).not.toHaveBeenCalled();

    runner.stop();
  });

  it("runOnce defaults to manual reason", async () => {
    const mockRunTurn = vi.fn(async () => "HEARTBEAT_OK");
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    await runner.runOnce("agent-1");

    expect(mockRunTurn).toHaveBeenCalledWith(
      "agent-1",
      expect.stringContaining("Current time:"),
      "manual",
    );
  });

  it("runOnce with cron-event reason produces cron prompt", async () => {
    const mockRunTurn = vi.fn(async () => "processed cron output");
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    await runner.runOnce("agent-1", "cron-event");

    expect(mockRunTurn).toHaveBeenCalledWith(
      "agent-1",
      expect.stringContaining("Do NOT respond with HEARTBEAT_OK"),
      "cron-event",
    );
    expect(mockRunTurn).toHaveBeenCalledWith(
      "agent-1",
      expect.stringContaining("scheduled reminder"),
      "cron-event",
    );
  });

  it("runOnce with exec-event reason produces exec prompt", async () => {
    const mockRunTurn = vi.fn(async () => "processed exec output");
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    await runner.runOnce("agent-1", "exec-event");

    expect(mockRunTurn).toHaveBeenCalledWith(
      "agent-1",
      expect.stringContaining("Do NOT respond with HEARTBEAT_OK"),
      "exec-event",
    );
    expect(mockRunTurn).toHaveBeenCalledWith(
      "agent-1",
      expect.stringContaining("async command"),
      "exec-event",
    );
  });

  it("tick uses scheduled reason", async () => {
    const mockRunTurn = vi.fn(async () => "HEARTBEAT_OK");
    const { runner } = makeRunner(mockRunTurn);
    runner.registerAgent("agent-1", 60_000);

    runner.start();
    await vi.advanceTimersByTimeAsync(65_000);

    expect(mockRunTurn).toHaveBeenCalledWith("agent-1", expect.any(String), "scheduled");

    runner.stop();
  });

  it("skips preflight for cron-event reason", async () => {
    const mockRunTurn = vi.fn(async () => "cron output");
    const mockPreFlight = vi.fn(async () => false);
    const { runner } = makeRunner(mockRunTurn, mockPreFlight);
    runner.registerAgent("agent-1", 60_000);

    const event = await runner.runOnce("agent-1", "cron-event");

    expect(mockPreFlight).not.toHaveBeenCalled();
    expect(mockRunTurn).toHaveBeenCalled();
    expect(event.hasContent).toBe(true);
  });

  it("skips preflight for exec-event reason", async () => {
    const mockRunTurn = vi.fn(async () => "exec output");
    const mockPreFlight = vi.fn(async () => false);
    const { runner } = makeRunner(mockRunTurn, mockPreFlight);
    runner.registerAgent("agent-1", 60_000);

    const event = await runner.runOnce("agent-1", "exec-event");

    expect(mockPreFlight).not.toHaveBeenCalled();
    expect(mockRunTurn).toHaveBeenCalled();
    expect(event.hasContent).toBe(true);
  });

  it("still runs preflight for scheduled reason", async () => {
    const mockRunTurn = vi.fn(async () => "HEARTBEAT_OK");
    const mockPreFlight = vi.fn(async () => false);
    const { runner } = makeRunner(mockRunTurn, mockPreFlight);
    runner.registerAgent("agent-1", 60_000);

    await runner.runOnce("agent-1", "scheduled");

    expect(mockPreFlight).toHaveBeenCalledWith("agent-1");
    expect(mockRunTurn).not.toHaveBeenCalled();
  });

  it("still runs preflight for manual reason", async () => {
    const mockRunTurn = vi.fn(async () => "HEARTBEAT_OK");
    const mockPreFlight = vi.fn(async () => false);
    const { runner } = makeRunner(mockRunTurn, mockPreFlight);
    runner.registerAgent("agent-1", 60_000);

    await runner.runOnce("agent-1", "manual");

    expect(mockPreFlight).toHaveBeenCalledWith("agent-1");
    expect(mockRunTurn).not.toHaveBeenCalled();
  });
});
