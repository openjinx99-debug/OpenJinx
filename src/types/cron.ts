import type { ChannelId } from "./config.js";

/** A persisted cron job definition. */
export interface CronJob {
  id: string;
  /** Human-readable name. */
  name: string;
  /** The schedule for this job. */
  schedule: CronSchedule;
  /** What to do when the job fires. */
  payload: CronPayload;
  /** Target session/agent. */
  target: CronTarget;
  /** Whether the job is enabled. */
  enabled: boolean;
  /** Timestamp of creation. */
  createdAt: number;
  /** Timestamp of last execution. */
  lastRunAt?: number;
  /** Timestamp of next scheduled run. */
  nextRunAt: number;
  /** Number of consecutive failures. */
  failCount: number;
  /** Current backoff delay in ms (0 if healthy). */
  backoffMs: number;
}

/** When the job should fire. */
export type CronSchedule =
  | { type: "at"; timestamp: number }
  | { type: "every"; intervalMs: number }
  | { type: "cron"; expression: string; timezone?: string };

/** What to do when a cron job fires. */
export interface CronPayload {
  /** Prompt text to send to the agent. */
  prompt: string;
  /** Whether to create an isolated session (vs. enqueue to heartbeat). */
  isolated: boolean;
}

/** Where to deliver cron results. */
export interface CronTarget {
  agentId: string;
  /** Session key to post results to. */
  sessionKey?: string;
  /** Channel + recipient for result delivery. */
  deliverTo?: {
    channel: ChannelId;
    to: string;
    accountId?: string;
  };
}
