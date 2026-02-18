import fs from "node:fs";
import path from "node:path";
import type { SystemEvent, SystemEventQueue } from "../types/events.js";
import { createLogger } from "../infra/logger.js";
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from "../infra/security.js";

const MAX_EVENTS_PER_SESSION = 20;
const logger = createLogger("events:queue");

interface EventQueueOptions {
  persistPath?: string;
  maxEventsPerSession?: number;
}

interface PersistedEventQueue {
  idCounter: number;
  queues: Record<string, SystemEvent[]>;
}

/**
 * Create an in-memory session-scoped FIFO event queue.
 */
export function createEventQueue(options: EventQueueOptions = {}): SystemEventQueue {
  const maxEventsPerSession = options.maxEventsPerSession ?? MAX_EVENTS_PER_SESSION;
  const queues = new Map<string, SystemEvent[]>();
  let idCounter = 0;
  const persistPath = options.persistPath;

  const persist = (): void => {
    if (!persistPath) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(persistPath), { recursive: true, mode: SECURE_DIR_MODE });
      const payload: PersistedEventQueue = {
        idCounter,
        queues: Object.fromEntries(queues.entries()),
      };
      const tmpPath = `${persistPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload), { mode: SECURE_FILE_MODE });
      fs.renameSync(tmpPath, persistPath);
    } catch (err) {
      logger.warn(`Failed to persist event queue: ${err}`);
    }
  };

  if (persistPath) {
    try {
      const data = fs.readFileSync(persistPath, "utf-8");
      const parsed = JSON.parse(data) as PersistedEventQueue;
      if (parsed && typeof parsed === "object" && parsed.queues && typeof parsed.queues === "object") {
        for (const [sessionKey, events] of Object.entries(parsed.queues)) {
          if (!Array.isArray(events)) {
            continue;
          }
          const normalized = events.filter((e) => {
            return (
              e &&
              typeof e.id === "string" &&
              typeof e.text === "string" &&
              typeof e.timestamp === "number" &&
              typeof e.source === "string" &&
              typeof e.sessionKey === "string"
            );
          });
          if (normalized.length > 0) {
            queues.set(sessionKey, normalized);
          }
        }
      }

      if (typeof parsed?.idCounter === "number" && Number.isFinite(parsed.idCounter)) {
        idCounter = parsed.idCounter;
      } else {
        const maxId = Math.max(
          0,
          ...Array.from(queues.values())
            .flat()
            .map((e) => Number.parseInt(e.id.replace("evt-", ""), 10))
            .filter((n) => Number.isFinite(n)),
        );
        idCounter = maxId;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn(`Failed to load persisted event queue: ${err}`);
      }
    }
  }

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
      if (queue.length >= maxEventsPerSession) {
        queue.shift();
      }

      queue.push({
        id: `evt-${++idCounter}`,
        text,
        timestamp: Date.now(),
        source,
        sessionKey,
      });
      persist();
    },

    peek(sessionKey) {
      return queues.get(sessionKey) ?? [];
    },

    drain(sessionKey) {
      const events = queues.get(sessionKey) ?? [];
      queues.delete(sessionKey);
      persist();
      return events;
    },

    count(sessionKey) {
      return queues.get(sessionKey)?.length ?? 0;
    },
  };
}
