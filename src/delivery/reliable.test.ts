import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChannelPlugin } from "../types/channels.js";
import { deliverWithRetryAndFallback } from "./reliable.js";

const mockDeliverOutboundPayloads = vi.fn();
vi.mock("./deliver.js", () => ({
  deliverOutboundPayloads: (...args: unknown[]) => mockDeliverOutboundPayloads(...args),
}));

function makeChannel(isReady: () => boolean): ChannelPlugin {
  return {
    id: "telegram",
    name: "Telegram",
    capabilities: { maxTextLength: 4096 },
    isReady,
    send: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as ChannelPlugin;
}

describe("deliverWithRetryAndFallback", () => {
  const tmpDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("retries channel-not-ready attempts and succeeds once channel becomes ready", async () => {
    let readinessChecks = 0;
    const channel = makeChannel(() => {
      readinessChecks++;
      return readinessChecks >= 3;
    });

    mockDeliverOutboundPayloads.mockResolvedValue({
      channel: "telegram",
      to: "user-1",
      textChunks: 1,
      mediaItems: 0,
      success: true,
    });

    const onAttemptFailed = vi.fn();
    const onSucceeded = vi.fn();

    const result = await deliverWithRetryAndFallback({
      payload: { text: "hello" },
      target: { channel: "telegram", to: "user-1" },
      deps: { getChannel: () => channel },
      source: "heartbeat",
      reason: "alert",
      maxAttempts: 3,
      retryBaseMs: 1,
      retryMaxMs: 1,
      onAttemptFailed,
      onSucceeded,
      emitFallback: vi.fn(),
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(onAttemptFailed).toHaveBeenCalledTimes(2);
    expect(onSucceeded).toHaveBeenCalledTimes(1);
    expect(mockDeliverOutboundPayloads).toHaveBeenCalledTimes(1);
  });

  it("writes dead-letter and emits terminal fallback after retries are exhausted", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reliable-delivery-test-"));
    tmpDirs.push(tmpDir);
    const deadLetterPath = path.join(tmpDir, "dead-letter.jsonl");

    const channel = makeChannel(() => true);
    mockDeliverOutboundPayloads.mockResolvedValue({
      channel: "telegram",
      to: "user-1",
      textChunks: 0,
      mediaItems: 0,
      success: false,
      error: "network down",
    });

    const emitFallback = vi.fn();

    const result = await deliverWithRetryAndFallback({
      payload: {
        text: "final report",
        media: [
          {
            type: "document",
            mimeType: "text/plain",
            filename: "report.txt",
            buffer: new Uint8Array(Buffer.from("hello")),
          },
        ],
      },
      target: { channel: "telegram", to: "user-1" },
      deps: { getChannel: () => channel },
      source: "deep-work",
      reason: "completion",
      maxAttempts: 2,
      retryBaseMs: 1,
      retryMaxMs: 1,
      deadLetterPath,
      emitFallback,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.deadLetterPath).toBe(deadLetterPath);
    expect(emitFallback).toHaveBeenCalledTimes(1);
    expect(String(emitFallback.mock.calls[0][1])).toContain("Delivery fallback");
    expect(fs.existsSync(deadLetterPath)).toBe(true);

    const lines = fs.readFileSync(deadLetterPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { source: string; reason: string; payload: { media: [] } };
    expect(parsed.source).toBe("deep-work");
    expect(parsed.reason).toBe("completion");
    expect(parsed.payload.media).toHaveLength(1);
  });
});
