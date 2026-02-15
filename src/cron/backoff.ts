/** Minimum backoff: 30 seconds. */
const MIN_BACKOFF_MS = 30_000;
/** Maximum backoff: 60 minutes. */
const MAX_BACKOFF_MS = 60 * 60_000;
/** Disable a job after this many consecutive failures. */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Compute exponential backoff delay for a failed cron job.
 * Range: 30 seconds to 60 minutes.
 */
export function computeCronBackoff(failCount: number): number {
  if (failCount <= 0) {
    return 0;
  }

  const delay = MIN_BACKOFF_MS * Math.pow(2, failCount - 1);
  return Math.min(delay, MAX_BACKOFF_MS);
}

/**
 * Whether a job should be auto-disabled due to consecutive failures.
 * Disables after 3 consecutive failures.
 */
export function shouldDisableJob(failCount: number): boolean {
  return failCount >= MAX_CONSECUTIVE_FAILURES;
}
