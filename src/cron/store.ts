import fs from "node:fs";
import path from "node:path";
import type { CronJob } from "../types/cron.js";
import { createLogger } from "../infra/logger.js";
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from "../infra/security.js";

const logger = createLogger("cron:store");

/**
 * Persists cron jobs to a JSON file.
 */
export class CronStore {
  private jobs = new Map<string, CronJob>();

  constructor(private readonly filePath: string) {}

  /** Load jobs from disk. */
  load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        logger.debug(`No cron store at ${this.filePath}, starting fresh`);
        return;
      }
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const arr = JSON.parse(raw) as CronJob[];
      this.jobs.clear();
      for (const job of arr) {
        this.jobs.set(job.id, job);
      }
      logger.info(`Loaded ${this.jobs.size} cron jobs`);
    } catch (err) {
      logger.error("Failed to load cron store", err);
    }
  }

  /** Save jobs to disk. */
  save(): void {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true, mode: SECURE_DIR_MODE });
      const data = JSON.stringify([...this.jobs.values()], null, 2);
      fs.writeFileSync(this.filePath, data, { encoding: "utf-8", mode: SECURE_FILE_MODE });
      logger.debug(`Saved ${this.jobs.size} cron jobs`);
    } catch (err) {
      logger.error("Failed to save cron store", err);
    }
  }

  /** Add a job. */
  add(job: CronJob): void {
    this.jobs.set(job.id, job);
  }

  /** Remove a job by ID. Returns true if the job existed. */
  remove(id: string): boolean {
    return this.jobs.delete(id);
  }

  /** Get a job by ID. */
  get(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  /** List all jobs. */
  list(): CronJob[] {
    return [...this.jobs.values()];
  }

  /** Update a job in place. */
  update(id: string, patch: Partial<CronJob>): void {
    const existing = this.jobs.get(id);
    if (!existing) {
      return;
    }
    Object.assign(existing, patch);
  }
}
