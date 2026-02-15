import { describe, expect, it } from "vitest";
import type { SystemEvent } from "../types/events.js";
import { compactSystemEvent, formatSystemEvents, filterNoiseEvents } from "./formatting.js";

function makeEvent(overrides: Partial<SystemEvent> & { text: string }): SystemEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    source: "system",
    sessionKey: "session-1",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("formatSystemEvents", () => {
  it("returns empty string for empty array", () => {
    expect(formatSystemEvents([])).toBe("");
  });

  it("formats events with time, source, and text", () => {
    // Use a fixed timestamp: 2025-01-15T10:30:45.000Z
    const ts = new Date("2025-01-15T10:30:45.000Z").getTime();
    const events = [makeEvent({ text: "Server started", source: "system", timestamp: ts })];

    const result = formatSystemEvents(events);
    expect(result).toContain("<system-events>");
    expect(result).toContain("</system-events>");
    expect(result).toContain("[10:30:45]");
    expect(result).toContain("[system]");
    expect(result).toContain("Server started");
  });

  it("formats multiple events with proper line separation", () => {
    const ts1 = new Date("2025-01-15T08:00:00.000Z").getTime();
    const ts2 = new Date("2025-01-15T08:01:00.000Z").getTime();

    const events = [
      makeEvent({ text: "First event", source: "heartbeat", timestamp: ts1 }),
      makeEvent({ text: "Second event", source: "cron", timestamp: ts2 }),
    ];

    const result = formatSystemEvents(events);
    const lines = result.split("\n");

    expect(lines[0]).toBe("<system-events>");
    expect(lines[1]).toBe("[08:00:00] [heartbeat] First event");
    expect(lines[2]).toBe("[08:01:00] [cron] Second event");
    expect(lines[3]).toBe("</system-events>");
  });

  it("uses ISO time substring for formatting", () => {
    // Midnight UTC: 00:00:00
    const ts = new Date("2025-06-01T00:00:00.000Z").getTime();
    const events = [makeEvent({ text: "midnight", timestamp: ts })];
    const result = formatSystemEvents(events);
    expect(result).toContain("[00:00:00]");
  });
});

describe("filterNoiseEvents", () => {
  it("returns all events when no duplicates exist", () => {
    const events = [
      makeEvent({ text: "Event A", timestamp: 1000 }),
      makeEvent({ text: "Event B", timestamp: 2000 }),
      makeEvent({ text: "Event C", timestamp: 3000 }),
    ];
    const result = filterNoiseEvents(events);
    expect(result).toHaveLength(3);
  });

  it("filters duplicate events within the default 60s window", () => {
    const base = Date.now();
    const events = [
      makeEvent({ text: "Duplicate", timestamp: base }),
      makeEvent({ text: "Duplicate", timestamp: base + 30_000 }), // 30s later — within window
    ];
    const result = filterNoiseEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(base);
  });

  it("allows duplicates outside the dedupe window", () => {
    const base = Date.now();
    const events = [
      makeEvent({ text: "Duplicate", timestamp: base }),
      makeEvent({ text: "Duplicate", timestamp: base + 61_000 }), // 61s later — outside window
    ];
    const result = filterNoiseEvents(events);
    expect(result).toHaveLength(2);
  });

  it("accepts a custom dedupe window", () => {
    const base = Date.now();
    const events = [
      makeEvent({ text: "Repeat", timestamp: base }),
      makeEvent({ text: "Repeat", timestamp: base + 5_000 }), // 5s later
    ];

    // Default window (60s) would filter the second event
    expect(filterNoiseEvents(events)).toHaveLength(1);

    // Smaller window (3s) allows the second event through
    expect(filterNoiseEvents(events, 3_000)).toHaveLength(2);
  });

  it("deduplicates only events with the same text", () => {
    const base = Date.now();
    const events = [
      makeEvent({ text: "Event A", timestamp: base }),
      makeEvent({ text: "Event B", timestamp: base + 1000 }),
      makeEvent({ text: "Event A", timestamp: base + 2000 }), // within window, same text as first
    ];
    const result = filterNoiseEvents(events);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.text)).toEqual(["Event A", "Event B"]);
  });

  it("returns empty array for empty input", () => {
    expect(filterNoiseEvents([])).toEqual([]);
  });
});

describe("compactSystemEvent", () => {
  it("returns trimmed text for normal events", () => {
    expect(compactSystemEvent("  User said hello  ")).toBe("User said hello");
  });

  it("returns null for empty string", () => {
    expect(compactSystemEvent("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(compactSystemEvent("   \n  ")).toBeNull();
  });

  it("filters 'reason periodic' noise", () => {
    expect(compactSystemEvent("Heartbeat fired reason periodic")).toBeNull();
  });

  it("filters 'heartbeat poll' noise", () => {
    expect(compactSystemEvent("heartbeat poll check")).toBeNull();
  });

  it("filters 'heartbeat wake' noise", () => {
    expect(compactSystemEvent("heartbeat wake triggered")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(compactSystemEvent("REASON PERIODIC check")).toBeNull();
    expect(compactSystemEvent("Heartbeat Poll event")).toBeNull();
    expect(compactSystemEvent("HEARTBEAT WAKE signal")).toBeNull();
  });

  it("preserves events that mention heartbeat in job name", () => {
    expect(compactSystemEvent("[Cron: check-heartbeat-status] Run report")).toBe(
      "[Cron: check-heartbeat-status] Run report",
    );
  });
});

describe("formatSystemEvents with compaction", () => {
  it("filters compacted noise events from output", () => {
    const ts = new Date("2025-01-15T10:30:45.000Z").getTime();
    const events = [
      makeEvent({ text: "User reminder: check mail", source: "cron", timestamp: ts }),
      makeEvent({ text: "heartbeat poll check", source: "system", timestamp: ts + 1000 }),
    ];

    const result = formatSystemEvents(events);
    expect(result).toContain("User reminder: check mail");
    expect(result).not.toContain("heartbeat poll");
  });

  it("returns empty string when all events are compacted away", () => {
    const events = [
      makeEvent({ text: "reason periodic", timestamp: 1000 }),
      makeEvent({ text: "heartbeat wake triggered", timestamp: 2000 }),
    ];

    expect(formatSystemEvents(events)).toBe("");
  });
});
