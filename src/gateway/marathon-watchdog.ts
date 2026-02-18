import type { CronJob } from "../types/cron.js";

interface WatchdogCheckpoint {
  status?: string;
}

export interface MarathonWatchdogLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface MarathonWatchdogDeps {
  isExecutorAlive(taskId: string): boolean;
  removeJob(jobId: string): boolean;
  readCheckpoint(taskId: string): Promise<WatchdogCheckpoint | undefined>;
  resume(taskId: string): Promise<void>;
  logger: MarathonWatchdogLogger;
}

/**
 * Handle a cron watchdog tick for a marathon task.
 * Returns:
 * - undefined when the job is not a watchdog job
 * - "watchdog ok" when nothing needs cleanup
 * - "watchdog stale removed" when a stale watchdog was removed
 */
export async function handleMarathonWatchdogJob(
  job: CronJob,
  deps: MarathonWatchdogDeps,
): Promise<"watchdog ok" | "watchdog stale removed" | undefined> {
  if (!job.payload.marathonWatchdog) {
    return undefined;
  }

  const { taskId } = job.payload.marathonWatchdog;
  if (deps.isExecutorAlive(taskId)) {
    return "watchdog ok";
  }

  const checkpoint = await deps.readCheckpoint(taskId);
  if (!checkpoint) {
    const removed = deps.removeJob(job.id);
    deps.logger.info(
      `Marathon watchdog: removed stale job=${job.id} task=${taskId} (checkpoint missing, removed=${removed})`,
    );
    return "watchdog stale removed";
  }

  if (checkpoint.status !== "paused" && checkpoint.status !== "executing") {
    const removed = deps.removeJob(job.id);
    deps.logger.info(
      `Marathon watchdog: removed stale job=${job.id} task=${taskId} status=${checkpoint.status} (removed=${removed})`,
    );
    return "watchdog stale removed";
  }

  deps.logger.info(`Marathon watchdog: executor dead for task=${taskId}, resuming...`);
  try {
    await deps.resume(taskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Marathon not found")) {
      const removed = deps.removeJob(job.id);
      deps.logger.warn(
        `Marathon watchdog resume failed for ${taskId}: ${msg} (stale job removed=${removed})`,
      );
      return "watchdog stale removed";
    }
    deps.logger.warn(`Marathon watchdog resume failed for ${taskId}: ${msg}`);
  }

  return "watchdog ok";
}
