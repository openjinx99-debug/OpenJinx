import type { HeartbeatReason } from "../types/heartbeat.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("heartbeat");

/** Pending wake requests (coalesced by agent ID). */
const pendingWakes = new Map<string, NodeJS.Timeout>();

const COALESCE_MS = 250;
const RETRY_DELAY_MS = 1000;
const MAX_RETRIES = 5;

export type WakeResult = { status: "ok" } | { status: "skipped"; reason: "lane-busy" | string };

export type HeartbeatWakeCallback = (
  agentId: string,
  reason: HeartbeatReason,
) => Promise<WakeResult>;

let wakeCallback: HeartbeatWakeCallback | undefined;

/** Register the callback that fires when a heartbeat wake is requested. */
export function onHeartbeatWake(callback: HeartbeatWakeCallback): void {
  wakeCallback = callback;
}

/**
 * Request an immediate heartbeat for an agent.
 * Multiple rapid requests are coalesced with a 250ms window.
 */
export function requestHeartbeatNow(agentId: string, reason: HeartbeatReason = "manual"): void {
  scheduleWake(agentId, reason, COALESCE_MS, 0);
}

function scheduleWake(
  agentId: string,
  reason: HeartbeatReason,
  delayMs: number,
  retryCount: number,
): void {
  // Cancel any pending coalesced wake for this agent
  const existing = pendingWakes.get(agentId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(async () => {
    pendingWakes.delete(agentId);
    if (!wakeCallback) {
      return;
    }

    try {
      const result = await wakeCallback(agentId, reason);
      if (result.status === "skipped" && retryCount < MAX_RETRIES) {
        logger.debug(
          `Wake skipped for ${agentId} (${result.reason}), retry ${retryCount + 1}/${MAX_RETRIES}`,
        );
        scheduleWake(agentId, reason, RETRY_DELAY_MS, retryCount + 1);
      }
    } catch (err) {
      logger.warn(`Heartbeat wake failed for ${agentId}: ${err}`);
      if (retryCount < MAX_RETRIES) {
        logger.debug(
          `Retrying wake for ${agentId} after error, retry ${retryCount + 1}/${MAX_RETRIES}`,
        );
        scheduleWake(agentId, reason, RETRY_DELAY_MS, retryCount + 1);
      }
    }
  }, delayMs);

  timer.unref();
  pendingWakes.set(agentId, timer);
}

/** Cancel all pending wake requests (for shutdown). */
export function cancelAllWakes(): void {
  for (const timer of pendingWakes.values()) {
    clearTimeout(timer);
  }
  pendingWakes.clear();
}
