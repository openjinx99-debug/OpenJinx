import type { ChannelPlugin } from "../types/channels.js";
import type { HeartbeatEvent, HeartbeatVisibility } from "../types/heartbeat.js";
import type { SessionStore } from "../types/sessions.js";
import { deliverWithRetryAndFallback } from "../delivery/reliable.js";
import { resolveDeliveryTarget } from "../delivery/targets.js";
import { createLogger } from "../infra/logger.js";
import { logProductTelemetry } from "../infra/product-telemetry.js";
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
 *   4. Deliver with retry/dead-letter guarantees
 *   5. Fall back to terminal on failure or if no channel is available
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
    void deliverWithRetryAndFallback({
      payload: { text: event.text },
      target,
      deps: {
        getChannel: deps.getChannel,
      },
      source: "heartbeat",
      reason: event.wasOk ? "ok" : "alert",
      maxAttempts: 3,
      retryBaseMs: 100,
      retryMaxMs: 800,
      terminalText: text,
      emitFallback: (sessionKey, fallbackText) => {
        emitStreamEvent(sessionKey, {
          type: "final",
          text: fallbackText,
        });
        logger.info(`Heartbeat delivered to terminal for ${event.agentId}`);
      },
      onAttemptFailed: (metadata) => {
        logger.debug(
          `Heartbeat delivery attempt failed for ${event.agentId} on ${target.channel}: ${String(
            metadata.error ?? "unknown error",
          )}`,
        );
        logProductTelemetry({
          area: "delivery",
          event: "heartbeat_delivery_attempt_failed",
          agentId: event.agentId,
          channel: target.channel,
          reason: metadata.reason,
          attempt: metadata.attempt,
          maxAttempts: metadata.maxAttempts,
          error: metadata.error,
        });
      },
      onSucceeded: () => {
        logger.info(
          `Heartbeat delivered to ${target.channel}:${target.to} for ${event.agentId} (${event.text!.length} chars)`,
        );
        logProductTelemetry({
          area: "delivery",
          event: "heartbeat_delivery_succeeded",
          agentId: event.agentId,
          channel: target.channel,
          reason: event.wasOk ? "ok" : "alert",
          textLength: event.text?.length ?? 0,
        });
      },
      onFallback: (metadata) => {
        logger.warn(
          `Heartbeat delivery failed for ${event.agentId} on ${target.channel}: ${String(metadata.error ?? "unknown error")}`,
        );
        logProductTelemetry({
          area: "delivery",
          event: "heartbeat_delivery_fallback_terminal",
          agentId: event.agentId,
          channel: target.channel,
          reason: metadata.reason,
          error: metadata.error,
          deadLetterPath: metadata.deadLetterPath,
        });
      },
    }).catch((err) => {
      logger.warn(`Heartbeat delivery error for ${event.agentId}: ${err}`);
      deliverToTerminal(text, event.agentId);
    });
    return;
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
