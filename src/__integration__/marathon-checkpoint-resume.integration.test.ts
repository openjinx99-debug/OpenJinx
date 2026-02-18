/**
 * Integration: Marathon checkpoint lifecycle — plan, execute, pause, resume, cancel.
 *
 * Uses real checkpoint CRUD on the filesystem, mocking only the agent runner
 * and container manager boundaries.
 */
import fs from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_HOME = `/tmp/jinx-marathon-integration-${Date.now()}`;

vi.mock("../infra/home-dir.js", () => ({
  homeRelative: (rel: string) => `${TEST_HOME}/${rel}`,
  resolveHomeDir: () => TEST_HOME,
  ensureHomeDir: () => TEST_HOME,
  expandTilde: (p: string) => p,
}));

vi.mock("../infra/security.js", () => ({
  SECURE_DIR_MODE: 0o700,
  SECURE_FILE_MODE: 0o600,
  isPathAllowed: () => true,
  detectInjectionPatterns: () => [],
}));

vi.mock("../infra/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  createCheckpoint,
  readCheckpoint,
  advanceCheckpoint,
  failChunk,
  cancelCheckpoint,
  pauseCheckpoint,
  updateCheckpointStatus,
  listCheckpoints,
} from "../pipeline/checkpoint.js";

beforeEach(async () => {
  await fs.rm(TEST_HOME, { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(TEST_HOME, { recursive: true, force: true });
});

const basePlan = {
  goal: "Build a todo app",
  chunks: [
    { name: "scaffold", prompt: "Create project", estimatedMinutes: 5 },
    { name: "api", prompt: "Build API", estimatedMinutes: 10 },
    { name: "tests", prompt: "Write tests", estimatedMinutes: 10 },
  ],
};

const baseParams = {
  taskId: "marathon-integ-1",
  sessionKey: "marathon:integ-1",
  containerId: "jinx-marathon-integ-abc",
  plan: basePlan,
  deliverTo: { channel: "telegram" as const, to: "user123" },
  workspaceDir: "/tmp/tasks/marathon-integ-1",
  originSessionKey: "telegram:dm:user123",
  maxRetriesPerChunk: 3,
};

describe("marathon checkpoint lifecycle", () => {
  it("full lifecycle: plan → chunk1 → chunk2 → chunk3 → complete", async () => {
    // Create checkpoint
    const cp = await createCheckpoint(baseParams);
    expect(cp.status).toBe("planning");
    expect(cp.currentChunkIndex).toBe(0);

    // Transition to executing
    await updateCheckpointStatus(baseParams.taskId, "executing");

    // Chunk 1
    let updated = await advanceCheckpoint(baseParams.taskId, {
      chunkName: "scaffold",
      status: "completed",
      summary: "Project scaffolded",
      filesWritten: ["package.json", "tsconfig.json"],
      durationMs: 30_000,
      completedAt: Date.now(),
      failedAttempts: 0,
    });
    expect(updated.currentChunkIndex).toBe(1);
    expect(updated.status).toBe("executing");

    // Chunk 2
    updated = await advanceCheckpoint(baseParams.taskId, {
      chunkName: "api",
      status: "completed",
      summary: "API built",
      filesWritten: ["src/api.ts"],
      durationMs: 60_000,
      completedAt: Date.now(),
      failedAttempts: 0,
    });
    expect(updated.currentChunkIndex).toBe(2);

    // Chunk 3 (final)
    updated = await advanceCheckpoint(baseParams.taskId, {
      chunkName: "tests",
      status: "completed",
      summary: "Tests written",
      filesWritten: ["src/api.test.ts"],
      durationMs: 45_000,
      completedAt: Date.now(),
      failedAttempts: 0,
    });
    expect(updated.status).toBe("completed");
    expect(updated.completedChunks).toHaveLength(3);
  });

  it("checkpoint persists across simulated process restart", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    await advanceCheckpoint(baseParams.taskId, {
      chunkName: "scaffold",
      status: "completed",
      summary: "Done",
      filesWritten: ["package.json"],
      durationMs: 10_000,
      completedAt: Date.now(),
      failedAttempts: 0,
    });

    // Simulate restart: read checkpoint fresh from disk
    const restored = await readCheckpoint(baseParams.taskId);
    expect(restored).toBeDefined();
    expect(restored!.currentChunkIndex).toBe(1);
    expect(restored!.completedChunks).toHaveLength(1);
    expect(restored!.status).toBe("executing");
  });

  it("failed chunk retries then pauses", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    // Fail 3 times (maxRetriesPerChunk = 3)
    let cp = await failChunk(baseParams.taskId, "Build error 1");
    expect(cp.status).toBe("executing");

    cp = await failChunk(baseParams.taskId, "Build error 2");
    expect(cp.status).toBe("executing");

    cp = await failChunk(baseParams.taskId, "Build error 3");
    expect(cp.status).toBe("paused");

    // Verify from disk
    const persisted = await readCheckpoint(baseParams.taskId);
    expect(persisted!.status).toBe("paused");
  });

  it("paused marathon resumes from correct chunk", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    // Complete first chunk
    await advanceCheckpoint(baseParams.taskId, {
      chunkName: "scaffold",
      status: "completed",
      summary: "Done",
      filesWritten: [],
      durationMs: 5000,
      completedAt: Date.now(),
      failedAttempts: 0,
    });

    // Pause
    await pauseCheckpoint(baseParams.taskId);
    let cp = await readCheckpoint(baseParams.taskId);
    expect(cp!.status).toBe("paused");
    expect(cp!.currentChunkIndex).toBe(1); // Should resume from chunk 1 (api)

    // Resume
    await updateCheckpointStatus(baseParams.taskId, "executing");
    cp = await readCheckpoint(baseParams.taskId);
    expect(cp!.status).toBe("executing");
    expect(cp!.currentChunkIndex).toBe(1); // Still at chunk 1
  });

  it("cancelled marathon cleans up", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    await cancelCheckpoint(baseParams.taskId);
    const cp = await readCheckpoint(baseParams.taskId);
    expect(cp!.status).toBe("cancelled");

    // Cannot advance cancelled checkpoint
    await expect(
      advanceCheckpoint(baseParams.taskId, {
        chunkName: "scaffold",
        status: "completed",
        summary: "",
        filesWritten: [],
        durationMs: 0,
        completedAt: Date.now(),
        failedAttempts: 0,
      }),
    ).rejects.toThrow("Cannot advance cancelled");
  });

  it("maxConcurrent enforced via listing", async () => {
    // Create two checkpoints
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    await createCheckpoint({
      ...baseParams,
      taskId: "marathon-integ-2",
      sessionKey: "marathon:integ-2",
    });
    await updateCheckpointStatus("marathon-integ-2", "executing");

    const active = await listCheckpoints({ status: ["executing"] });
    expect(active).toHaveLength(2);

    // Caller can check active.length >= config.marathon.maxConcurrent
    // before launching a new marathon
  });

  it("startup resume finds executing checkpoints", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    await createCheckpoint({
      ...baseParams,
      taskId: "marathon-integ-paused",
      sessionKey: "marathon:integ-paused",
    });
    await updateCheckpointStatus("marathon-integ-paused", "paused");

    await createCheckpoint({
      ...baseParams,
      taskId: "marathon-integ-done",
      sessionKey: "marathon:integ-done",
    });
    // Don't transition - stays in "planning"

    // Find active checkpoints for startup resume
    const executing = await listCheckpoints({ status: ["executing"] });
    expect(executing).toHaveLength(1);
    expect(executing[0].taskId).toBe(baseParams.taskId);

    const paused = await listCheckpoints({ status: ["paused"] });
    expect(paused).toHaveLength(1);
    expect(paused[0].taskId).toBe("marathon-integ-paused");
  });
});
