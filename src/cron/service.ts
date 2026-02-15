import type { CronJob } from "../types/cron.js";
import type { CreateJobParams } from "./jobs.js";
import { createLogger } from "../infra/logger.js";
import { executeJobCore } from "./executor.js";
import { createJob } from "./jobs.js";
import { CronStore } from "./store.js";
import { CronTimer } from "./timer.js";

const logger = createLogger("cron:service");

export interface CronServiceDeps {
  persistPath: string;
  maxJobs: number;
  /** Execute a cron job via the agent runner. Receives the full job for session/tier control. */
  runTurn: (job: CronJob) => Promise<string>;
}

/**
 * High-level cron service: manages jobs, persistence, and the tick timer.
 */
export class CronService {
  private store: CronStore;
  private timer: CronTimer;
  private maxJobs: number;
  private runTurn: (job: CronJob) => Promise<string>;

  constructor(deps: CronServiceDeps) {
    this.store = new CronStore(deps.persistPath);
    this.maxJobs = deps.maxJobs;
    this.runTurn = deps.runTurn;

    this.timer = new CronTimer(
      () => this.store.list(),
      (job) => this.executeJob(job),
    );
  }

  /** Start the cron service: load persisted jobs and begin ticking. */
  start(): void {
    this.store.load();
    this.timer.start();
    logger.info(`Cron service started (${this.store.list().length} jobs)`);
  }

  /** Stop the cron service and persist jobs. */
  stop(): void {
    this.timer.stop();
    this.store.save();
    logger.info("Cron service stopped");
  }

  /** Add a new cron job. Throws if at capacity. */
  add(params: CreateJobParams): CronJob {
    if (this.store.list().length >= this.maxJobs) {
      throw new Error(`Maximum cron jobs reached (${this.maxJobs})`);
    }
    const job = createJob(params);
    this.store.add(job);
    this.store.save();
    logger.info(`Added job "${job.name}" (${job.id})`);
    return job;
  }

  /** Update an existing job. */
  update(id: string, patch: Partial<CronJob>): void {
    this.store.update(id, patch);
    this.store.save();
  }

  /** Remove a job by ID. */
  remove(id: string): boolean {
    const removed = this.store.remove(id);
    if (removed) {
      this.store.save();
    }
    return removed;
  }

  /** List all jobs. */
  list(): CronJob[] {
    return this.store.list();
  }

  /** Get a job by ID. */
  get(id: string): CronJob | undefined {
    return this.store.get(id);
  }

  /** Force-run a job immediately, ignoring schedule. */
  async run(id: string): Promise<void> {
    const job = this.store.get(id);
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }
    await this.executeJob(job);
  }

  private async executeJob(job: CronJob): Promise<void> {
    await executeJobCore(job, this.runTurn);
    this.store.save();
  }
}
