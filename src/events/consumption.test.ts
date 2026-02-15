import { describe, expect, it, vi } from "vitest";
import type { SystemEvent, SystemEventQueue } from "../types/events.js";
import { prependSystemEvents } from "./consumption.js";

function makeQueue(events: SystemEvent[]): SystemEventQueue {
  let drained = false;
  return {
    enqueue: vi.fn(),
    peek: vi.fn(() => events),
    drain: vi.fn(() => {
      if (drained) {
        return [];
      }
      drained = true;
      return events;
    }),
    count: vi.fn(() => (drained ? 0 : events.length)),
  };
}

function makeEvent(text: string, timestamp: number): SystemEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    text,
    timestamp,
    source: "system",
    sessionKey: "session-1",
  };
}

describe("prependSystemEvents", () => {
  it("returns prompt unchanged when queue is empty", () => {
    const queue = makeQueue([]);
    const result = prependSystemEvents(queue, "session-1", "Hello agent");
    expect(result).toBe("Hello agent");
  });

  it("prepends formatted events before the prompt", () => {
    const ts = new Date("2025-01-15T12:00:00.000Z").getTime();
    const events = [makeEvent("Server rebooted", ts)];
    const queue = makeQueue(events);

    const result = prependSystemEvents(queue, "session-1", "User message");

    expect(result).toContain("<system-events>");
    expect(result).toContain("Server rebooted");
    expect(result).toContain("</system-events>");
    expect(result).toContain("User message");
    // Events should appear before the prompt
    const eventsEnd = result.indexOf("</system-events>");
    const promptStart = result.indexOf("User message");
    expect(eventsEnd).toBeLessThan(promptStart);
  });

  it("calls drain on the queue", () => {
    const events = [makeEvent("event", Date.now())];
    const queue = makeQueue(events);

    prependSystemEvents(queue, "session-1", "prompt");

    expect(queue.drain).toHaveBeenCalledWith("session-1");
  });

  it("filters noise events before formatting", () => {
    const base = Date.now();
    // Two identical events within 60s window — only one should survive
    const events = [makeEvent("Same event", base), makeEvent("Same event", base + 10_000)];
    const queue = makeQueue(events);

    const result = prependSystemEvents(queue, "session-1", "prompt");

    // Count occurrences of the event text in the output
    const matches = result.match(/Same event/g);
    expect(matches).toHaveLength(1);
  });

  it("separates events from prompt with double newline", () => {
    const ts = new Date("2025-01-15T12:00:00.000Z").getTime();
    const queue = makeQueue([makeEvent("alert", ts)]);

    const result = prependSystemEvents(queue, "session-1", "Hello");

    expect(result).toContain("</system-events>\n\nHello");
  });
});
