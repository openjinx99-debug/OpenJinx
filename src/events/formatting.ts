import type { SystemEvent } from "../types/events.js";

/**
 * Filter infrastructure noise from a single event's text.
 * Returns the trimmed text if it's meaningful, or null if it should be dropped.
 */
export function compactSystemEvent(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes("reason periodic")) {
    return null;
  }
  if (lower.includes("heartbeat poll") || lower.includes("heartbeat wake")) {
    return null;
  }
  return trimmed;
}

/**
 * Format system events for inclusion in the agent prompt.
 * Applies compaction to filter infrastructure noise before formatting.
 */
export function formatSystemEvents(events: SystemEvent[]): string {
  if (events.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const e of events) {
    const compacted = compactSystemEvent(e.text);
    if (compacted === null) {
      continue;
    }
    const time = new Date(e.timestamp).toISOString().slice(11, 19);
    lines.push(`[${time}] [${e.source}] ${compacted}`);
  }

  if (lines.length === 0) {
    return "";
  }

  return ["<system-events>", ...lines, "</system-events>"].join("\n");
}

/**
 * Filter noise events (duplicates within a time window, etc.).
 */
export function filterNoiseEvents(events: SystemEvent[], dedupeWindowMs = 60_000): SystemEvent[] {
  const seen = new Map<string, number>();
  return events.filter((e) => {
    const lastSeen = seen.get(e.text);
    if (lastSeen && e.timestamp - lastSeen < dedupeWindowMs) {
      return false;
    }
    seen.set(e.text, e.timestamp);
    return true;
  });
}
