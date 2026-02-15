import type { CronJob } from "../types/cron.js";
import { createLogger } from "../infra/logger.js";
import { computeCronBackoff, shouldDisableJob } from "./backoff.js";
import { computeNextRun } from "./jobs.js";

const logger = createLogger("cron:executor");

/**
 * Execute a single cron job by calling the provided agent turn function.
 * Updates the job's timing and failure state in place.
 */
export async function executeJobCore(
  job: CronJob,
  runTurn: (job: CronJob) => Promise<string>,
): Promise<void> {
  const { name, id } = job;
  logger.info(`Executing job "${name}" (${id})`);

  try {
    const result = await runTurn(job);
    logger.debug(`Job "${name}" completed: ${result.slice(0, 120)}...`);

    // Success — reset failure state and schedule next run
    job.lastRunAt = Date.now();
    job.failCount = 0;
    job.backoffMs = 0;
    job.nextRunAt = computeNextRun(job.schedule, Date.now());

    // One-shot jobs disable themselves after running
    if (job.schedule.type === "at") {
      job.enabled = false;
    }
  } catch (err) {
    job.failCount++;
    job.backoffMs = computeCronBackoff(job.failCount);
    job.nextRunAt = Date.now() + job.backoffMs;

    logger.warn(
      `Job "${name}" failed (attempt ${job.failCount}, next retry in ${job.backoffMs}ms)`,
      err,
    );

    if (shouldDisableJob(job.failCount)) {
      job.enabled = false;
      logger.error(`Job "${name}" disabled after ${job.failCount} consecutive failures`);
    }
  }
}
