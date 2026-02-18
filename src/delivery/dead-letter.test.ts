import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendDeadLetterReplayRecord,
  getDeadLetterPaths,
  getReplayLogPath,
  readDeadLetterEntries,
  readDeadLetterReplayRecords,
  summarizeDeadLetters,
} from "./dead-letter.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? "/tmp", "dead-letter-test-"));
  vi.stubEnv("JINX_HOME", tmpDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("readDeadLetterEntries", () => {
  it("reads and merges entries from default dead-letter paths", async () => {
    const [deliveryPath, marathonPath] = getDeadLetterPaths();
    fs.mkdirSync(path.dirname(deliveryPath), { recursive: true });
    fs.mkdirSync(path.dirname(marathonPath), { recursive: true });

    fs.writeFileSync(
      deliveryPath,
      `${JSON.stringify({
        id: "dl-1",
        timestamp: 1000,
        source: "deep-work",
        reason: "completion",
        attempts: 3,
        error: "channel down",
        target: { channel: "telegram", to: "user-1" },
        payload: { text: "hello", media: [] },
      })}\n`,
    );

    fs.writeFileSync(
      marathonPath,
      `${JSON.stringify({
        id: "dl-2",
        timestamp: 2000,
        source: "marathon",
        reason: "progress",
        attempts: 3,
        error: "channel down",
        target: { channel: "whatsapp", to: "group-1" },
        payload: { text: "status update", media: [] },
      })}\n`,
    );

    const entries = await readDeadLetterEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("dl-2");
    expect(entries[1].id).toBe("dl-1");
  });

  it("filters by since and limit", async () => {
    const [deliveryPath] = getDeadLetterPaths();
    fs.mkdirSync(path.dirname(deliveryPath), { recursive: true });
    fs.writeFileSync(
      deliveryPath,
      [
        {
          id: "dl-1",
          timestamp: 1000,
          source: "deep-work",
          reason: "completion",
          attempts: 3,
          error: "x",
          target: { channel: "telegram", to: "u1" },
          payload: { text: "a", media: [] },
        },
        {
          id: "dl-2",
          timestamp: 2000,
          source: "deep-work",
          reason: "completion",
          attempts: 3,
          error: "y",
          target: { channel: "telegram", to: "u1" },
          payload: { text: "b", media: [] },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n",
    );

    const entries = await readDeadLetterEntries({ since: 1500, limit: 1 });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("dl-2");
  });
});

describe("summarizeDeadLetters", () => {
  it("aggregates counts by source/channel/reason", () => {
    const summary = summarizeDeadLetters([
      {
        id: "1",
        timestamp: 1000,
        source: "marathon",
        reason: "completion",
        attempts: 3,
        error: "x",
        target: { channel: "telegram", to: "u1" },
        payload: { text: "t1", media: [] },
      },
      {
        id: "2",
        timestamp: 2000,
        source: "deep-work",
        reason: "completion",
        attempts: 3,
        error: "y",
        target: { channel: "telegram", to: "u2" },
        payload: { text: "t2", media: [] },
      },
      {
        id: "3",
        timestamp: 3000,
        source: "deep-work",
        reason: "progress",
        attempts: 3,
        error: "z",
        target: { channel: "whatsapp", to: "g1" },
        payload: { text: "t3", media: [] },
      },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.bySource["deep-work"]).toBe(2);
    expect(summary.bySource["marathon"]).toBe(1);
    expect(summary.byChannel.telegram).toBe(2);
    expect(summary.byChannel.whatsapp).toBe(1);
    expect(summary.byReason.completion).toBe(2);
    expect(summary.byReason.progress).toBe(1);
    expect(summary.oldestTimestamp).toBe(1000);
    expect(summary.latestTimestamp).toBe(3000);
  });
});

describe("dead-letter replay log", () => {
  it("appends and reads replay records", async () => {
    await appendDeadLetterReplayRecord({
      timestamp: 1234,
      deadLetterId: "dl-1",
      status: "success",
      channel: "telegram",
      to: "user-1",
    });

    const records = await readDeadLetterReplayRecords();
    expect(records).toHaveLength(1);
    expect(records[0].deadLetterId).toBe("dl-1");
    expect(records[0].status).toBe("success");
    expect(getReplayLogPath()).toContain("dead-letter-replay.jsonl");
  });
});
