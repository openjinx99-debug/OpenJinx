import { describe, expect, it, vi } from "vitest";
import type { MarathonCheckpoint } from "../types/marathon.js";
import type { MarathonDeps } from "./marathon.js";
import { buildProgressUpdateText, deliverMarathonPayload } from "./marathon-delivery.js";

vi.mock("../delivery/reliable.js", () => ({
  deliverWithRetryAndFallback: vi.fn(),
}));

vi.mock("../pipeline/checkpoint.js", () => ({
  resolveMarathonDir: vi.fn().mockReturnValue("/tmp/marathon"),
}));

vi.mock("./streaming.js", () => ({
  emitStreamEvent: vi.fn(),
}));

const { deliverWithRetryAndFallback } = await import("../delivery/reliable.js");

function makeCheckpoint(overrides?: Partial<MarathonCheckpoint>): MarathonCheckpoint {
  return {
    taskId: "marathon-1",
    sessionKey: "marathon:1",
    containerId: "container-1",
    status: "executing",
    plan: {
      goal: "Build app",
      chunks: [
        {
          name: "setup",
          prompt: "do setup",
          estimatedMinutes: 10,
          acceptanceCriteria: ["file_exists: package.json", "tests_pass"],
        },
        {
          name: "api",
          prompt: "do api",
          estimatedMinutes: 20,
          acceptanceCriteria: ["file_exists: src/api.ts", "tests_pass"],
        },
      ],
    },
    currentChunkIndex: 1,
    completedChunks: [
      {
        chunkName: "setup",
        status: "completed",
        summary: "done",
        filesWritten: ["README.md", "dist/index.html", "src/main.ts"],
        durationMs: 1000,
        completedAt: Date.now(),
        failedAttempts: 0,
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deliverTo: { channel: "telegram", to: "123" },
    workspaceDir: "/tmp/workspace",
    originSessionKey: "telegram:dm:123",
    maxRetriesPerChunk: 2,
    ...overrides,
  };
}

function makeDeps(): MarathonDeps {
  return {
    config: {
      marathon: {
        progress: {
          includeFileSummary: true,
          updateIntervalChunks: 1,
        },
      },
    } as MarathonDeps["config"],
    sessions: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      save: vi.fn(),
      load: vi.fn(),
    },
    channels: new Map(),
  };
}

describe("buildProgressUpdateText", () => {
  it("includes likely outputs when present", () => {
    const text = buildProgressUpdateText(makeCheckpoint(), true);
    expect(text).toContain("progress: 1/2 chunks");
    expect(text).toContain("Last completed: **setup**");
    expect(text).toContain("Likely outputs:");
    expect(text).toContain("dist/index.html");
  });

  it("falls back to generic workspace update when no progress artifacts qualify", () => {
    const checkpoint = makeCheckpoint({
      completedChunks: [
        {
          chunkName: "setup",
          status: "completed",
          summary: "done",
          filesWritten: ["src/main.ts", "README.md"],
          durationMs: 1000,
          completedAt: Date.now(),
          failedAttempts: 0,
        },
      ],
    });
    const text = buildProgressUpdateText(checkpoint, true);
    expect(text).toContain("Workspace updated (2 files tracked).");
  });
});

describe("deliverMarathonPayload", () => {
  it("uses reliable delivery with marathon dead-letter path", async () => {
    vi.mocked(deliverWithRetryAndFallback).mockImplementation(async (opts) => {
      opts.onSucceeded?.({
        attempts: 1,
        textChunks: 1,
        mediaItems: 0,
      });
      return {
        success: true,
        fallbackDelivered: false,
        attempts: 1,
      };
    });

    const emitTelemetry = vi.fn();
    await deliverMarathonPayload({
      text: "hello",
      media: [],
      target: { channel: "telegram", to: "123" },
      deps: makeDeps(),
      emitTelemetry,
      context: { taskId: "marathon-1", reason: "progress" },
    });

    expect(deliverWithRetryAndFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "marathon",
        reason: "progress",
        taskId: "marathon-1",
        deadLetterPath: "/tmp/marathon/dead-letter.jsonl",
      }),
    );
    expect(emitTelemetry).toHaveBeenCalledWith(
      "marathon_delivery_succeeded",
      expect.objectContaining({ taskId: "marathon-1" }),
    );
  });
});
