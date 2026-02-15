import type { CronJob } from "../types/cron.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("cron:timer");

/** Maximum delay clamp — never sleep longer than 60 seconds. */
const MAX_DELAY_MS = 60_000;

/**
 * A single timer that fires periodically to find and execute due cron jobs.
 */
export class CronTimer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(
    private readonly getJobs: () => CronJob[],
    private readonly onDue: (job: CronJob) => void | Promise<void>,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    logger.info("Cron timer started");
    this.scheduleTick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    logger.info("Cron timer stopped");
  }

  /** Process one tick: find due jobs and fire callbacks. */
  async tick(): Promise<void> {
    const now = Date.now();
    const jobs = this.getJobs();

    for (const job of jobs) {
      if (!job.enabled) {
        continue;
      }
      if (job.nextRunAt > now) {
        continue;
      }

      logger.debug(`Job "${job.name}" (${job.id}) is due`);
      try {
        await this.onDue(job);
      } catch (err) {
        logger.error(`Error running job "${job.name}"`, err);
      }
    }
  }

  private scheduleTick(): void {
    if (!this.running) {
      return;
    }

    const delay = this.computeDelay();
    this.timer = setTimeout(async () => {
      await this.tick();
      this.scheduleTick();
    }, delay);
  }

  private computeDelay(): number {
    const jobs = this.getJobs().filter((j) => j.enabled);
    if (jobs.length === 0) {
      return MAX_DELAY_MS;
    }

    const now = Date.now();
    const soonest = Math.min(...jobs.map((j) => j.nextRunAt));
    const delay = Math.max(0, soonest - now);

    return Math.min(delay, MAX_DELAY_MS);
  }
}
