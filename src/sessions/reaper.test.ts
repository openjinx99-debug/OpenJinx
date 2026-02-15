import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionEntry, SessionStore } from "../types/sessions.js";
import { SessionReaper } from "./reaper.js";

vi.mock("node:fs/promises", () => ({
  default: {
    unlink: vi.fn(async () => {}),
  },
}));

import fs from "node:fs/promises";
const mockedUnlink = vi.mocked(fs.unlink);

function makeSessionEntry(overrides: Partial<SessionEntry> & { sessionKey: string }): SessionEntry {
  const now = Date.now();
  return {
    sessionId: crypto.randomUUID(),
    agentId: "agent-1",
    channel: "terminal",
    createdAt: now,
    lastActiveAt: now,
    turnCount: 1,
    transcriptPath: `/tmp/sessions/${overrides.sessionKey.replace(/[^a-zA-Z0-9]/g, "_")}.jsonl`,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    contextTokens: 0,
    locked: false,
    ...overrides,
  };
}

function makeStore(sessions: SessionEntry[]): SessionStore {
  const map = new Map<string, SessionEntry>();
  for (const s of sessions) {
    map.set(s.sessionKey, s);
  }
  return {
    get: (key) => map.get(key),
    set: (key, entry) => map.set(key, entry),
    delete: (key) => map.delete(key),
    list: () => [...map.values()],
    save: vi.fn(async () => {}),
    load: vi.fn(async () => {}),
  };
}

describe("SessionReaper", () => {
  const now = Date.now();
  const oldTime = now - 25 * 60 * 60 * 1000; // 25 hours ago
  const recentTime = now - 1 * 60 * 60 * 1000; // 1 hour ago

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reaps old sessions matching prefix", async () => {
    const sessions = [
      makeSessionEntry({ sessionKey: "cron:agent-1:123", lastActiveAt: oldTime }),
      makeSessionEntry({ sessionKey: "cron:agent-1:456", lastActiveAt: oldTime }),
    ];
    const store = makeStore(sessions);
    const reaper = new SessionReaper(store, { prefixes: ["cron:"] });

    const count = await reaper.sweep(now);

    expect(count).toBe(2);
    expect(store.list()).toHaveLength(0);
  });

  it("skips fresh sessions", async () => {
    const sessions = [
      makeSessionEntry({ sessionKey: "cron:agent-1:123", lastActiveAt: recentTime }),
    ];
    const store = makeStore(sessions);
    const reaper = new SessionReaper(store, { prefixes: ["cron:"] });

    const count = await reaper.sweep(now);

    expect(count).toBe(0);
    expect(store.list()).toHaveLength(1);
  });

  it("skips sessions not matching any prefix", async () => {
    const sessions = [
      makeSessionEntry({ sessionKey: "heartbeat:agent-1", lastActiveAt: oldTime }),
      makeSessionEntry({ sessionKey: "terminal:dm:local", lastActiveAt: oldTime }),
    ];
    const store = makeStore(sessions);
    const reaper = new SessionReaper(store, { prefixes: ["cron:"] });

    const count = await reaper.sweep(now);

    expect(count).toBe(0);
    expect(store.list()).toHaveLength(2);
  });

  it("deletes transcript file for reaped sessions", async () => {
    const session = makeSessionEntry({
      sessionKey: "cron:agent-1:123",
      lastActiveAt: oldTime,
      transcriptPath: "/tmp/sessions/cron_agent-1_123.jsonl",
    });
    const store = makeStore([session]);
    const reaper = new SessionReaper(store, { prefixes: ["cron:"] });

    await reaper.sweep(now);

    expect(mockedUnlink).toHaveBeenCalledWith("/tmp/sessions/cron_agent-1_123.jsonl");
  });

  it("handles missing transcript file gracefully", async () => {
    mockedUnlink.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    const session = makeSessionEntry({
      sessionKey: "cron:agent-1:123",
      lastActiveAt: oldTime,
    });
    const store = makeStore([session]);
    const reaper = new SessionReaper(store, { prefixes: ["cron:"] });

    const count = await reaper.sweep(now);

    // Should still reap the session even if transcript was already gone
    expect(count).toBe(1);
    expect(store.list()).toHaveLength(0);
  });

  it("saves store after reaping", async () => {
    const session = makeSessionEntry({
      sessionKey: "cron:agent-1:123",
      lastActiveAt: oldTime,
    });
    const store = makeStore([session]);
    const reaper = new SessionReaper(store, { prefixes: ["cron:"] });

    await reaper.sweep(now);

    expect(store.save).toHaveBeenCalledOnce();
  });

  it("does not save store when nothing reaped", async () => {
    const store = makeStore([]);
    const reaper = new SessionReaper(store, { prefixes: ["cron:"] });

    await reaper.sweep(now);

    expect(store.save).not.toHaveBeenCalled();
  });

  it("start/stop timer lifecycle", () => {
    vi.useFakeTimers();
    const store = makeStore([]);
    const reaper = new SessionReaper(store, {
      prefixes: ["cron:"],
      intervalMs: 5000,
    });

    reaper.start();

    // Verify timer is running by spying on sweep
    const sweepSpy = vi.spyOn(reaper, "sweep").mockResolvedValue(0);

    vi.advanceTimersByTime(5000);
    expect(sweepSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(sweepSpy).toHaveBeenCalledTimes(2);

    reaper.stop();

    vi.advanceTimersByTime(10_000);
    expect(sweepSpy).toHaveBeenCalledTimes(2); // No more calls after stop

    vi.useRealTimers();
  });
});
