import type { SystemEvent, SystemEventQueue } from "../types/events.js";

const MAX_EVENTS_PER_SESSION = 20;

/**
 * Create an in-memory session-scoped FIFO event queue.
 */
export function createEventQueue(): SystemEventQueue {
  const queues = new Map<string, SystemEvent[]>();
  let idCounter = 0;

  return {
    enqueue(text, sessionKey, source) {
      let queue = queues.get(sessionKey);
      if (!queue) {
        queue = [];
        queues.set(sessionKey, queue);
      }

      // Suppress consecutive duplicates
      if (queue.length > 0 && queue[queue.length - 1].text === text) {
        return;
      }

      // Enforce max queue size (drop oldest)
      if (queue.length >= MAX_EVENTS_PER_SESSION) {
        queue.shift();
      }

      queue.push({
        id: `evt-${++idCounter}`,
        text,
        timestamp: Date.now(),
        source,
        sessionKey,
      });
    },

    peek(sessionKey) {
      return queues.get(sessionKey) ?? [];
    },

    drain(sessionKey) {
      const events = queues.get(sessionKey) ?? [];
      queues.delete(sessionKey);
      return events;
    },

    count(sessionKey) {
      return queues.get(sessionKey)?.length ?? 0;
    },
  };
}
