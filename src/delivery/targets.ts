import type { DeliveryTarget } from "../types/messages.js";
import type { SessionEntry } from "../types/sessions.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("delivery:targets");

/**
 * Resolve a delivery target from a session's context.
 *
 * Strategies:
 *   "last"     → use most recent channel from the session
 *   "none"     → no delivery
 *   explicit   → use the specified channel, to, and accountId
 */
export function resolveDeliveryTarget(
  target: DeliveryTarget | "last" | "none",
  session?: SessionEntry,
): DeliveryTarget | undefined {
  if (target === "none") {
    return undefined;
  }

  if (target === "last") {
    if (!session) {
      logger.warn("Cannot resolve 'last' target without a session");
      return undefined;
    }
    const channel = session.channel;
    if (!channel) {
      logger.warn("Session has no channel for 'last' resolution");
      return undefined;
    }
    return {
      channel,
      to: session.groupId ?? session.peerId ?? "",
    };
  }

  // Explicit target
  return target;
}
