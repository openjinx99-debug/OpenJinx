import { describe, expect, it, vi } from "vitest";
import type { CronJob } from "../types/cron.js";
import { handleMarathonWatchdogJob } from "./marathon-watchdog.js";

function makeWatchdogJob(taskId: string): CronJob {
  return {
    id: "job-1",
    name: "marathon-watchdog:test",
    schedule: { type: "every", intervalMs: 300_000 },
    payload: {
      prompt: "watchdog",
      isolated: false,
      marathonWatchdog: { taskId },
    },
    target: { agentId: "default" },
    enabled: true,
    createdAt: Date.now(),
    nextRunAt: Date.now() + 300_000,
    failCount: 0,
    backoffMs: 0,
  };
}

describe("handleMarathonWatchdogJob", () => {
  it("returns undefined for non-watchdog jobs", async () => {
    const result = await handleMarathonWatchdogJob(
      {
        ...makeWatchdogJob("task-1"),
        payload: { prompt: "normal", isolated: false },
      },
      {
        isExecutorAlive: () => true,
        removeJob: () => false,
        readCheckpoint: vi.fn(),
        resume: vi.fn(),
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
        },
      },
    );
    expect(result).toBeUndefined();
  });

  it("removes stale job when checkpoint is missing", async () => {
    const removeJob = vi.fn().mockReturnValue(true);
    const result = await handleMarathonWatchdogJob(makeWatchdogJob("task-1"), {
      isExecutorAlive: () => false,
      removeJob,
      readCheckpoint: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(result).toBe("watchdog stale removed");
    expect(removeJob).toHaveBeenCalledWith("job-1");
  });

  it("removes stale job when checkpoint status is terminal", async () => {
    const removeJob = vi.fn().mockReturnValue(true);
    const result = await handleMarathonWatchdogJob(makeWatchdogJob("task-1"), {
      isExecutorAlive: () => false,
      removeJob,
      readCheckpoint: vi.fn().mockResolvedValue({ status: "completed" }),
      resume: vi.fn(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(result).toBe("watchdog stale removed");
    expect(removeJob).toHaveBeenCalledWith("job-1");
  });

  it("resumes when executor is dead and checkpoint is active", async () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    const result = await handleMarathonWatchdogJob(makeWatchdogJob("task-1"), {
      isExecutorAlive: () => false,
      removeJob: vi.fn(),
      readCheckpoint: vi.fn().mockResolvedValue({ status: "executing" }),
      resume,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(result).toBe("watchdog ok");
    expect(resume).toHaveBeenCalledWith("task-1");
  });

  it("removes stale job when resume reports marathon not found", async () => {
    const removeJob = vi.fn().mockReturnValue(true);
    const result = await handleMarathonWatchdogJob(makeWatchdogJob("task-1"), {
      isExecutorAlive: () => false,
      removeJob,
      readCheckpoint: vi.fn().mockResolvedValue({ status: "executing" }),
      resume: vi.fn().mockRejectedValue(new Error("Marathon not found: task-1")),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(result).toBe("watchdog stale removed");
    expect(removeJob).toHaveBeenCalledWith("job-1");
  });
});
