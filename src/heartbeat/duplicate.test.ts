import { describe, expect, it, beforeEach, vi } from "vitest";
import type { DuplicateStore } from "./duplicate.js";
import {
  isDuplicateHeartbeat,
  recordHeartbeatText,
  clearDuplicateStore,
  setPersistentDuplicateStore,
} from "./duplicate.js";

beforeEach(() => {
  clearDuplicateStore();
});

describe("duplicate detection", () => {
  it("detects duplicate text within 24h", () => {
    const now = Date.now();
    recordHeartbeatText("agent-1", "Weather is sunny", now);
    expect(isDuplicateHeartbeat("agent-1", "Weather is sunny", now + 1000)).toBe(true);
  });

  it("does not flag different text", () => {
    const now = Date.now();
    recordHeartbeatText("agent-1", "Weather is sunny", now);
    expect(isDuplicateHeartbeat("agent-1", "Storm approaching", now + 1000)).toBe(false);
  });

  it("does not flag text from different agents", () => {
    const now = Date.now();
    recordHeartbeatText("agent-1", "Weather is sunny", now);
    expect(isDuplicateHeartbeat("agent-2", "Weather is sunny", now + 1000)).toBe(false);
  });

  it("expires duplicates after 24h", () => {
    const now = Date.now();
    const dayLater = now + 25 * 60 * 60 * 1000;
    recordHeartbeatText("agent-1", "Weather is sunny", now);
    expect(isDuplicateHeartbeat("agent-1", "Weather is sunny", dayLater)).toBe(false);
  });

  it("does not expire within 24h window", () => {
    const now = Date.now();
    const almostDay = now + 23 * 60 * 60 * 1000;
    recordHeartbeatText("agent-1", "Still sunny", now);
    expect(isDuplicateHeartbeat("agent-1", "Still sunny", almostDay)).toBe(true);
  });

  it("clearDuplicateStore removes all entries", () => {
    recordHeartbeatText("agent-1", "text1");
    recordHeartbeatText("agent-2", "text2");
    clearDuplicateStore();
    expect(isDuplicateHeartbeat("agent-1", "text1")).toBe(false);
    expect(isDuplicateHeartbeat("agent-2", "text2")).toBe(false);
  });

  it("handles multiple entries per agent", () => {
    const now = Date.now();
    recordHeartbeatText("agent-1", "First", now);
    recordHeartbeatText("agent-1", "Second", now);
    expect(isDuplicateHeartbeat("agent-1", "First", now + 1000)).toBe(true);
    expect(isDuplicateHeartbeat("agent-1", "Second", now + 1000)).toBe(true);
    expect(isDuplicateHeartbeat("agent-1", "Third", now + 1000)).toBe(false);
  });
});

describe("persistent duplicate store", () => {
  beforeEach(() => {
    clearDuplicateStore();
  });

  it("falls back to persistent store after restart (empty in-memory)", () => {
    const now = Date.now();
    const store: DuplicateStore = {
      getLast: vi.fn(() => ({ text: "Weather is sunny", timestamp: now - 60_000 })),
      setLast: vi.fn(),
    };
    setPersistentDuplicateStore(store);

    // In-memory is empty (simulates restart), but persistent has the entry
    expect(isDuplicateHeartbeat("agent-1", "Weather is sunny", now)).toBe(true);
    expect(store.getLast).toHaveBeenCalledWith("agent-1");
  });

  it("records to both in-memory and persistent stores", () => {
    const now = Date.now();
    const store: DuplicateStore = {
      getLast: vi.fn(() => undefined),
      setLast: vi.fn(),
    };
    setPersistentDuplicateStore(store);

    recordHeartbeatText("agent-1", "Hello world", now);

    // In-memory should have it
    expect(isDuplicateHeartbeat("agent-1", "Hello world", now + 1000)).toBe(true);
    // Persistent store should have been written
    expect(store.setLast).toHaveBeenCalledWith("agent-1", "Hello world", now);
  });

  it("ignores persistent store when not set", () => {
    const now = Date.now();
    // No persistent store set — should just use in-memory
    expect(isDuplicateHeartbeat("agent-1", "Weather is sunny", now)).toBe(false);
  });

  it("respects 24h window in persistent store", () => {
    const now = Date.now();
    const oldTimestamp = now - 25 * 60 * 60 * 1000; // 25 hours ago
    const store: DuplicateStore = {
      getLast: vi.fn(() => ({ text: "Weather is sunny", timestamp: oldTimestamp })),
      setLast: vi.fn(),
    };
    setPersistentDuplicateStore(store);

    // Entry is older than 24h, should not be flagged as duplicate
    expect(isDuplicateHeartbeat("agent-1", "Weather is sunny", now)).toBe(false);
  });
});
