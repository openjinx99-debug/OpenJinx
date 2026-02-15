import type { SystemEventQueue } from "../types/events.js";
import { formatSystemEvents, filterNoiseEvents } from "./formatting.js";

/**
 * Drain system events for a session and prepend them to the agent prompt.
 */
export function prependSystemEvents(
  queue: SystemEventQueue,
  sessionKey: string,
  prompt: string,
): string {
  const events = queue.drain(sessionKey);
  if (events.length === 0) {
    return prompt;
  }

  const filtered = filterNoiseEvents(events);
  if (filtered.length === 0) {
    return prompt;
  }

  const formatted = formatSystemEvents(filtered);
  return `${formatted}\n\n${prompt}`;
}
