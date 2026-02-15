import type { HeartbeatEvent } from "../types/heartbeat.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("heartbeat:events");

export type HeartbeatEventListener = (event: HeartbeatEvent) => void;

const listeners: HeartbeatEventListener[] = [];

/** Subscribe to heartbeat events. */
export function onHeartbeatEvent(listener: HeartbeatEventListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) {
      listeners.splice(idx, 1);
    }
  };
}

/** Emit a heartbeat event to all listeners. */
export function emitHeartbeatEvent(event: HeartbeatEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      logger.warn("Heartbeat listener error", err);
    }
  }
}
