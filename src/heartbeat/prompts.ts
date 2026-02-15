import type { HeartbeatReason } from "../types/heartbeat.js";
import { formatZonedTimestamp } from "../infra/format-time.js";

/** Default heartbeat prompt sent to the agent on each cycle. */
export const DEFAULT_HEARTBEAT_PROMPT = `This is a scheduled heartbeat check.

1. Read HEARTBEAT.md and process any active items.
2. If no active items, consider memory maintenance:
   - Use memory_search to check recent daily logs for anything worth distilling
   - Update MEMORY.md with durable facts, decisions, or lessons if needed
   - Only do this if you haven't done it in the last few heartbeats
3. If nothing needs attention, respond with HEARTBEAT_OK.`;

/** Base prompt for cron-event triggered heartbeats. */
export const CRON_EVENT_BASE_PROMPT = `A scheduled reminder has been triggered. The reminder details are shown in the system events above.
Please relay this reminder to the user in a helpful and friendly way.
Do NOT respond with HEARTBEAT_OK.`;

/** Base prompt for exec-event triggered heartbeats. */
export const EXEC_EVENT_BASE_PROMPT = `An async command you ran earlier has completed. The result is shown in the system events above.
Please relay the command output to the user in a helpful way. If the command succeeded, share the relevant output. If it failed, explain what went wrong.
Do NOT respond with HEARTBEAT_OK.`;

/**
 * Select the appropriate heartbeat prompt based on why the heartbeat fired.
 * Prepends a `Current time:` header to all prompts.
 *
 * When `hasEvents` is explicitly `false` and reason is event-based,
 * falls back to the default heartbeat prompt (defensive: events were
 * already drained before prompt selection).
 */
export function selectHeartbeatPrompt(
  reason: HeartbeatReason,
  timezone?: string,
  hasEvents?: boolean,
): string {
  const now = new Date();
  const timeStr = formatZonedTimestamp(now, timezone) ?? now.toISOString();
  const header = timezone ? `Current time: ${timeStr} (${timezone})` : `Current time: ${timeStr}`;

  const isEventReason = reason === "cron-event" || reason === "exec-event";

  let body: string;
  if (isEventReason && hasEvents === false) {
    // Events were drained before we got here — fall back to default
    body = DEFAULT_HEARTBEAT_PROMPT;
  } else {
    switch (reason) {
      case "cron-event":
        body = CRON_EVENT_BASE_PROMPT;
        break;
      case "exec-event":
        body = EXEC_EVENT_BASE_PROMPT;
        break;
      case "scheduled":
      case "manual":
      default:
        body = DEFAULT_HEARTBEAT_PROMPT;
        break;
    }
  }

  return `${header}\n\n${body}`;
}

/** Prompt when a cron event triggered the heartbeat. */
export function buildCronEventPrompt(jobName: string, payload: string): string {
  return `A scheduled cron job "${jobName}" has fired. Process the following:\n\n${payload}`;
}

/** Prompt when an exec event triggered the heartbeat. */
export function buildExecEventPrompt(command: string, output: string): string {
  return `The following command was executed as part of a scheduled task:\n\nCommand: ${command}\nOutput:\n${output}`;
}

/** Prompt for pre-compaction memory flush. */
export const MEMORY_FLUSH_PROMPT = `Pre-compaction memory flush. Your context is about to be compacted.
Store any durable memories now using your file tools.
If nothing to store, reply with NO_REPLY.`;
