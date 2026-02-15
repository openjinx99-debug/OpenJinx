import type { ChatEvent } from "../types/messages.js";

export type StreamCallback = (event: ChatEvent) => void;

/** Registry of stream callbacks per session. */
const callbacks = new Map<string, Set<StreamCallback>>();

/** Subscribe to streaming events for a session. Returns an unsubscribe function. */
export function subscribeStream(sessionKey: string, callback: StreamCallback): () => void {
  let set = callbacks.get(sessionKey);
  if (!set) {
    set = new Set();
    callbacks.set(sessionKey, set);
  }
  set.add(callback);

  return () => {
    set!.delete(callback);
    if (set!.size === 0) {
      callbacks.delete(sessionKey);
    }
  };
}

/** Emit a streaming event to all subscribers for a session. */
export function emitStreamEvent(sessionKey: string, event: ChatEvent): void {
  const set = callbacks.get(sessionKey);
  if (!set) {
    return;
  }
  for (const cb of set) {
    try {
      cb(event);
    } catch {
      // Don't let a failing callback break other subscribers
    }
  }
}

/** Check if a session has active stream subscribers. */
export function hasStreamSubscribers(sessionKey: string): boolean {
  return (callbacks.get(sessionKey)?.size ?? 0) > 0;
}
