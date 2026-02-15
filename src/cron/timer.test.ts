import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CronJob } from "../types/cron.js";
import { CronTimer } from "./timer.js";

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: `job-${Math.random().toString(36).slice(2, 8)}`,
    name: "Test Job",
    schedule: { type: "every", intervalMs: 60_000 },
    payload: { prompt: "Run check", isolated: false },
    target: { agentId: "agent-1" },
    enabled: true,
    createdAt: Date.now(),
    nextRunAt: Date.now() + 60_000,
    failCount: 0,
    backoffMs: 0,
    ...overrides,
  };
}

describe("CronTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tick fires onDue for due jobs", async () => {
    const now = Date.now();
    const job = makeJob({ id: "due-job", nextRunAt: now - 1000 });
    const onDue = vi.fn();

    const timer = new CronTimer(() => [job], onDue);
    await timer.tick();

    expect(onDue).toHaveBeenCalledOnce();
    expect(onDue).toHaveBeenCalledWith(job);
  });

  it("tick skips disabled jobs", async () => {
    const now = Date.now();
    const job = makeJob({ id: "disabled-job", nextRunAt: now - 1000, enabled: false });
    const onDue = vi.fn();

    const timer = new CronTimer(() => [job], onDue);
    await timer.tick();

    expect(onDue).not.toHaveBeenCalled();
  });

  it("tick skips future jobs", async () => {
    const job = makeJob({ id: "future-job", nextRunAt: Date.now() + 999_999 });
    const onDue = vi.fn();

    const timer = new CronTimer(() => [job], onDue);
    await timer.tick();

    expect(onDue).not.toHaveBeenCalled();
  });

  it("start begins scheduling", () => {
    const timer = new CronTimer(() => [], vi.fn());
    // Should not throw
    expect(() => timer.start()).not.toThrow();
    timer.stop();
  });

  it("stop clears timer", async () => {
    const now = Date.now();
    const job = makeJob({ id: "stop-test", nextRunAt: now + 5000 });
    const onDue = vi.fn();

    const timer = new CronTimer(() => [job], onDue);
    timer.start();
    timer.stop();

    // Advance well past when the job would have been due
    await vi.advanceTimersByTimeAsync(120_000);

    // onDue should never have been called because we stopped
    expect(onDue).not.toHaveBeenCalled();
  });

  it("tick catches errors from onDue", async () => {
    const now = Date.now();
    const job = makeJob({ id: "error-job", nextRunAt: now - 1000 });
    const onDue = vi.fn(() => {
      throw new Error("Boom!");
    });

    const timer = new CronTimer(() => [job], onDue);

    // tick should not throw even though onDue throws
    await expect(timer.tick()).resolves.toBeUndefined();
    expect(onDue).toHaveBeenCalledOnce();
  });
});
