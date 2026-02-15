import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSessionStore, createSessionEntry } from "./store.js";

let tmpDir: string;
let savedJinxHome: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "jinx-store-test-"));
  savedJinxHome = process.env.JINX_HOME;
  process.env.JINX_HOME = tmpDir;
});

afterEach(async () => {
  if (savedJinxHome === undefined) {
    delete process.env.JINX_HOME;
  } else {
    process.env.JINX_HOME = savedJinxHome;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("createSessionEntry", () => {
  it("creates entry with defaults", () => {
    const entry = createSessionEntry({
      sessionKey: "test-key",
      agentId: "agent-1",
      channel: "terminal",
    });

    // sessionId should be a UUID
    expect(entry.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(entry.sessionKey).toBe("test-key");
    expect(entry.agentId).toBe("agent-1");
    expect(entry.channel).toBe("terminal");
    expect(entry.turnCount).toBe(0);
    expect(entry.locked).toBe(false);
    expect(entry.totalInputTokens).toBe(0);
    expect(entry.totalOutputTokens).toBe(0);
    expect(entry.contextTokens).toBe(0);
    expect(entry.transcriptPath).toBe("");
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.lastActiveAt).toBeGreaterThan(0);
  });

  it("uses overrides", () => {
    const entry = createSessionEntry({
      sessionKey: "test-key",
      agentId: "agent-1",
      channel: "telegram",
      turnCount: 5,
      locked: true,
      peerId: "peer-123",
      peerName: "Alice",
    });

    expect(entry.turnCount).toBe(5);
    expect(entry.locked).toBe(true);
    expect(entry.peerId).toBe("peer-123");
    expect(entry.peerName).toBe("Alice");
    expect(entry.channel).toBe("telegram");
  });
});

describe("SessionStore CRUD", () => {
  it("get/set/delete/list", () => {
    const store = createSessionStore();
    const entry = createSessionEntry({
      sessionKey: "s1",
      agentId: "a1",
      channel: "terminal",
    });

    // Initially empty
    expect(store.get("s1")).toBeUndefined();
    expect(store.list()).toHaveLength(0);

    // Set and get
    store.set("s1", entry);
    expect(store.get("s1")).toEqual(entry);
    expect(store.list()).toHaveLength(1);

    // Add another
    const entry2 = createSessionEntry({
      sessionKey: "s2",
      agentId: "a2",
      channel: "telegram",
    });
    store.set("s2", entry2);
    expect(store.list()).toHaveLength(2);

    // Delete
    expect(store.delete("s1")).toBe(true);
    expect(store.get("s1")).toBeUndefined();
    expect(store.list()).toHaveLength(1);

    // Delete non-existent
    expect(store.delete("nonexistent")).toBe(false);
  });
});

describe("SessionStore persistence", () => {
  it("save persists to JSON", async () => {
    const store = createSessionStore();
    const entry = createSessionEntry({
      sessionKey: "persist-key",
      agentId: "a1",
      channel: "terminal",
    });
    store.set("persist-key", entry);

    await store.save();

    const storePath = path.join(tmpDir, "sessions", "store.json");
    const raw = readFileSync(storePath, "utf-8");
    const data = JSON.parse(raw);
    expect(data["persist-key"]).toBeDefined();
    expect(data["persist-key"].sessionKey).toBe("persist-key");
    expect(data["persist-key"].agentId).toBe("a1");
  });

  it("load restores from JSON", async () => {
    // Prepare a JSON file manually
    const sessionsDir = path.join(tmpDir, "sessions");
    mkdirSync(sessionsDir, { recursive: true });

    const entry = {
      sessionId: "id-123",
      sessionKey: "load-key",
      agentId: "a2",
      channel: "whatsapp",
      createdAt: 1000,
      lastActiveAt: 2000,
      turnCount: 3,
      transcriptPath: "/path/to/transcript",
      totalInputTokens: 100,
      totalOutputTokens: 200,
      contextTokens: 50,
      locked: false,
    };

    writeFileSync(
      path.join(sessionsDir, "store.json"),
      JSON.stringify({ "load-key": entry }),
      "utf-8",
    );

    const store = createSessionStore();
    await store.load();

    const loaded = store.get("load-key");
    expect(loaded).toBeDefined();
    expect(loaded!.sessionId).toBe("id-123");
    expect(loaded!.agentId).toBe("a2");
    expect(loaded!.channel).toBe("whatsapp");
    expect(loaded!.turnCount).toBe(3);
    expect(store.list()).toHaveLength(1);
  });

  it("load handles missing file", async () => {
    // tmpDir is empty — no sessions/store.json
    const store = createSessionStore();
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });
});
