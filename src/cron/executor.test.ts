import { describe, expect, it } from "vitest";
import type { CronJob } from "../types/cron.js";
import { executeJobCore } from "./executor.js";

function makeJob(overrides?: Partial<CronJob>): CronJob {
  return {
    id: "test-job-1",
    name: "Test Job",
    schedule: { type: "every", intervalMs: 60_000 },
    payload: { prompt: "Do something", isolated: false },
    target: { agentId: "default" },
    enabled: true,
    createdAt: Date.now(),
    lastRunAt: undefined,
    nextRunAt: Date.now(),
    failCount: 0,
    backoffMs: 0,
    ...overrides,
  };
}

describe("executeJobCore", () => {
  it("updates job on success", async () => {
    const job = makeJob();
    await executeJobCore(job, async () => "done");
    expect(job.failCount).toBe(0);
    expect(job.lastRunAt).toBeGreaterThan(0);
    expect(job.nextRunAt).toBeGreaterThan(Date.now() - 1000);
  });

  it("passes full job to runTurn", async () => {
    const job = makeJob();
    let receivedJob: CronJob | undefined;
    await executeJobCore(job, async (j) => {
      receivedJob = j;
      return "done";
    });
    expect(receivedJob).toBe(job);
  });

  it("increments failCount on error", async () => {
    const job = makeJob();
    await executeJobCore(job, async () => {
      throw new Error("fail");
    });
    expect(job.failCount).toBe(1);
    expect(job.backoffMs).toBeGreaterThan(0);
  });

  it("disables job after 3 consecutive failures", async () => {
    const job = makeJob({ failCount: 2 });
    await executeJobCore(job, async () => {
      throw new Error("fail");
    });
    expect(job.failCount).toBe(3);
    expect(job.enabled).toBe(false);
  });

  it("disables one-shot jobs after success", async () => {
    const job = makeJob({
      schedule: { type: "at", timestamp: Date.now() },
    });
    await executeJobCore(job, async () => "done");
    expect(job.enabled).toBe(false);
  });

  it("resets fail state on success", async () => {
    const job = makeJob({ failCount: 2, backoffMs: 120_000 });
    await executeJobCore(job, async () => "done");
    expect(job.failCount).toBe(0);
    expect(job.backoffMs).toBe(0);
  });
});
