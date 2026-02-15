import type { ComposioTriggerPayload } from "../agents/tools/composio-tools.js";
import type { SystemEventQueue } from "../types/events.js";
import type { HeartbeatReason } from "../types/heartbeat.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("composio-triggers");

export interface TriggerSubscriberDeps {
  eventQueue: SystemEventQueue;
  defaultAgentId: string;
  apiKey: string;
  userId: string;
  timeoutSeconds: number;
  requestHeartbeatNow: (agentId: string, reason: HeartbeatReason) => void;
}

/**
 * Start a background Pusher-based trigger subscriber.
 * Returns a stop() function that calls triggers.unsubscribe().
 */
export async function startTriggerSubscriber(
  deps: TriggerSubscriberDeps,
): Promise<() => Promise<void>> {
  const { eventQueue, defaultAgentId, apiKey, requestHeartbeatNow } = deps;

  try {
    const { Composio } = await import("@composio/core");
    const client = new Composio({ apiKey }) as unknown as {
      triggers: {
        subscribe(fn: (data: ComposioTriggerPayload) => void, filters?: object): Promise<void>;
        unsubscribe(): Promise<void>;
      };
    };

    await client.triggers.subscribe((data) => {
      const slug = data.triggerSlug ?? data.triggerName ?? "UNKNOWN";
      const summary = formatTriggerSummary(data);
      const text = `[Trigger: ${slug}] ${summary}`;

      const heartbeatSessionKey = `heartbeat:${defaultAgentId}`;
      eventQueue.enqueue(text, heartbeatSessionKey, "composio-trigger");
      requestHeartbeatNow(defaultAgentId, "composio-trigger");

      logger.info(`Trigger event received: ${slug}`);
    });

    logger.info("Composio trigger subscriber started");

    return async () => {
      await client.triggers.unsubscribe();
      logger.info("Composio trigger subscriber stopped");
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Composio trigger subscriber failed to start: ${msg}`);
    return async () => {};
  }
}

function formatTriggerSummary(data: ComposioTriggerPayload): string {
  if (!data.payload || Object.keys(data.payload).length === 0) {
    return "Event received (no payload)";
  }

  // Build a concise key=value summary from the payload
  const entries = Object.entries(data.payload)
    .slice(0, 5)
    .map(([k, v]) => {
      const val = typeof v === "string" ? v.slice(0, 100) : JSON.stringify(v)?.slice(0, 100);
      return `${k}=${val}`;
    });

  return entries.join(", ");
}
