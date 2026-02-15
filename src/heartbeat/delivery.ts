import type { ChannelPlugin } from "../types/channels.js";
import type { HeartbeatEvent, HeartbeatVisibility } from "../types/heartbeat.js";
import type { SessionStore } from "../types/sessions.js";
import { deliverOutboundPayloads } from "../delivery/deliver.js";
import { resolveDeliveryTarget } from "../delivery/targets.js";
import { createLogger } from "../infra/logger.js";
import { chunkText } from "../markdown/chunk.js";
import { emitStreamEvent } from "../pipeline/streaming.js";
import { isAcknowledgment } from "./ack-filter.js";
import { shouldDeliver } from "./visibility.js";

const logger = createLogger("heartbeat:delivery");

export interface HeartbeatDeliveryDeps {
  sessions: SessionStore;
  visibility: HeartbeatVisibility;
  getChannel: (name: string) => ChannelPlugin | undefined;
}

/**
 * Deliver a heartbeat event to the appropriate channel.
 *
 * Resolution order:
 *   1. Check visibility — suppress if config says so
 *   2. Check ack filter — suppress short acknowledgments
 *   3. Resolve session → delivery target from last active channel
 *   4. Check channel readiness
 *   5. Deliver via deliverOutboundPayloads()
 *   6. Fall back to terminal on failure or if no channel is available
 */
export function deliverHeartbeatEvent(event: HeartbeatEvent, deps: HeartbeatDeliveryDeps): void {
  // 1. Visibility check
  if (!shouldDeliver(deps.visibility, event.hasContent, event.wasOk)) {
    logger.debug(`Heartbeat for ${event.agentId}: suppressed (visibility)`);
    return;
  }

  // 2. Ack filter
  if (!event.text || isAcknowledgment(event.text)) {
    return;
  }

  const prefix = deps.visibility.useIndicator ? "💓 " : "";
  const text = `\n${prefix}${event.text}`;

  // 3. Resolve delivery target from session
  const heartbeatSessionKey = `heartbeat:${event.agentId}`;
  const session = deps.sessions.get(heartbeatSessionKey);
  const target = resolveDeliveryTarget("last", session);

  // 4. Check channel readiness and deliver
  if (target) {
    const channel = deps.getChannel(target.channel);
    if (channel?.isReady()) {
      deliverOutboundPayloads({
        payload: { text: event.text },
        target,
        deps: {
          getChannel: deps.getChannel,
          chunkText,
        },
      })
        .then((result) => {
          if (result.success) {
            logger.info(
              `Heartbeat delivered to ${target.channel}:${target.to} for ${event.agentId} (${event.text!.length} chars)`,
            );
          } else {
            logger.warn(
              `Heartbeat delivery failed for ${event.agentId} on ${target.channel}: ${result.error}`,
            );
            deliverToTerminal(text, event.agentId);
          }
        })
        .catch((err) => {
          logger.warn(`Heartbeat delivery error for ${event.agentId}: ${err}`);
          deliverToTerminal(text, event.agentId);
        });
      return;
    }
    logger.debug(`Channel ${target.channel} not ready, falling back to terminal`);
  }

  // 5. Fallback: deliver to terminal
  deliverToTerminal(text, event.agentId);
}

function deliverToTerminal(text: string, agentId: string): void {
  const terminalSessionKey = "terminal:dm:local";
  emitStreamEvent(terminalSessionKey, {
    type: "final",
    text,
  });
  logger.info(`Heartbeat delivered to terminal for ${agentId}`);
}
