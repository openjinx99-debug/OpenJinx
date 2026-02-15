import { Cron } from "croner";
import { randomUUID } from "node:crypto";
import type { CronJob, CronSchedule, CronPayload, CronTarget } from "../types/cron.js";

export interface CreateJobParams {
  name: string;
  schedule: CronSchedule;
  payload: CronPayload;
  target: CronTarget;
  enabled?: boolean;
}

/**
 * Create a new CronJob with sensible defaults.
 */
export function createJob(params: CreateJobParams): CronJob {
  const now = Date.now();
  return {
    id: randomUUID(),
    name: params.name,
    schedule: params.schedule,
    payload: params.payload,
    target: params.target,
    enabled: params.enabled ?? true,
    createdAt: now,
    lastRunAt: undefined,
    nextRunAt: computeNextRun(params.schedule, now),
    failCount: 0,
    backoffMs: 0,
  };
}

/**
 * Compute the next run timestamp for a given schedule.
 */
export function computeNextRun(schedule: CronSchedule, now?: number): number {
  const ts = now ?? Date.now();

  switch (schedule.type) {
    case "at":
      // One-shot: run at the specified time (or immediately if past)
      return schedule.timestamp;

    case "every":
      // Interval: next run is now + interval
      return ts + schedule.intervalMs;

    case "cron":
      return computeNextCronRun(schedule.expression, ts, schedule.timezone);

    default:
      return ts + 60_000;
  }
}

/**
 * Parse a standard 5-field cron expression and find the next matching minute.
 * Uses croner for full cron syntax: ranges (1-5), lists (1,3,5),
 * steps (*​/N), day-of-week, and timezone support.
 * Falls back to +60s if parsing fails.
 */
export function computeNextCronRun(expression: string, now: number, timezone?: string): number {
  try {
    const job = new Cron(expression, {
      timezone,
    });
    const next = job.nextRun(new Date(now));
    if (next) {
      return next.getTime();
    }
    return now + 60_000; // no match — fallback
  } catch {
    return now + 60_000; // invalid expression — fallback
  }
}
