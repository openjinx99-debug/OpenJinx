import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock home-dir to use a temp directory
const TEST_HOME = "/tmp/jinx-checkpoint-test";
vi.mock("../infra/home-dir.js", () => ({
  homeRelative: (rel: string) => `${TEST_HOME}/${rel}`,
  resolveHomeDir: () => TEST_HOME,
  ensureHomeDir: () => TEST_HOME,
}));

vi.mock("../infra/security.js", () => ({
  SECURE_DIR_MODE: 0o700,
}));

const {
  createCheckpoint,
  readCheckpoint,
  advanceCheckpoint,
  failChunk,
  cancelCheckpoint,
  pauseCheckpoint,
  patchCheckpoint,
  updateCheckpointStatus,
  resetCurrentChunkRetries,
  listCheckpoints,
  resolveMarathonDir,
} = await import("./checkpoint.js");

const baseParams = {
  taskId: "test-task-1",
  sessionKey: "marathon:test-task-1",
  containerId: "jinx-marathon-abc12345",
  plan: {
    goal: "Build a todo app",
    chunks: [
      { name: "scaffold", prompt: "Create project structure", estimatedMinutes: 5 },
      { name: "api", prompt: "Build REST API", estimatedMinutes: 10 },
      { name: "tests", prompt: "Write tests", estimatedMinutes: 10 },
    ],
  },
  deliverTo: { channel: "telegram" as const, to: "user123" },
  workspaceDir: "/tmp/tasks/marathon-abc12345",
  originSessionKey: "telegram:dm:user123",
  maxRetriesPerChunk: 3,
};

describe("checkpoint", () => {
  beforeEach(async () => {
    await fs.rm(TEST_HOME, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_HOME, { recursive: true, force: true });
  });

  it("createCheckpoint writes valid JSON to marathon directory via homeRelative", async () => {
    const checkpoint = await createCheckpoint(baseParams);
    const dir = resolveMarathonDir();
    const filePath = path.join(dir, `${baseParams.taskId}.json`);
    const data = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    expect(parsed.taskId).toBe(baseParams.taskId);
    expect(checkpoint.taskId).toBe(baseParams.taskId);
  });

  it("createCheckpoint sets status planning and currentChunkIndex 0", async () => {
    const checkpoint = await createCheckpoint(baseParams);
    expect(checkpoint.status).toBe("planning");
    expect(checkpoint.currentChunkIndex).toBe(0);
    expect(checkpoint.completedChunks).toEqual([]);
  });

  it("createCheckpoint persists originSenderId when provided", async () => {
    const checkpoint = await createCheckpoint({
      ...baseParams,
      originSenderId: "owner-user-1",
    });

    expect(checkpoint.originSenderId).toBe("owner-user-1");
    const reloaded = await readCheckpoint(baseParams.taskId);
    expect(reloaded?.originSenderId).toBe("owner-user-1");
  });

  it("readCheckpoint returns checkpoint from disk", async () => {
    await createCheckpoint(baseParams);
    const checkpoint = await readCheckpoint(baseParams.taskId);
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.taskId).toBe(baseParams.taskId);
    expect(checkpoint!.sessionKey).toBe(baseParams.sessionKey);
  });

  it("readCheckpoint returns undefined for non-existent taskId", async () => {
    const checkpoint = await readCheckpoint("non-existent-task");
    expect(checkpoint).toBeUndefined();
  });

  it("advanceCheckpoint increments currentChunkIndex and appends ChunkResult", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    const result = {
      chunkName: "scaffold",
      status: "completed" as const,
      summary: "Created project structure",
      filesWritten: ["package.json", "tsconfig.json"],
      durationMs: 30000,
      completedAt: Date.now(),
      failedAttempts: 0,
    };

    const updated = await advanceCheckpoint(baseParams.taskId, result);
    expect(updated.currentChunkIndex).toBe(1);
    expect(updated.completedChunks).toHaveLength(1);
    expect(updated.completedChunks[0].chunkName).toBe("scaffold");
  });

  it("advanceCheckpoint sets status completed on final chunk", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    // Advance through all 3 chunks
    for (let i = 0; i < 3; i++) {
      const result = {
        chunkName: baseParams.plan.chunks[i].name,
        status: "completed" as const,
        summary: `Done ${i}`,
        filesWritten: [],
        durationMs: 1000,
        completedAt: Date.now(),
        failedAttempts: 0,
      };
      const updated = await advanceCheckpoint(baseParams.taskId, result);
      if (i === 2) {
        expect(updated.status).toBe("completed");
      }
    }
  });

  it("advanceCheckpoint resets chunk failedAttempts to 0", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    const result = {
      chunkName: "scaffold",
      status: "completed" as const,
      summary: "Done",
      filesWritten: [],
      durationMs: 1000,
      completedAt: Date.now(),
      failedAttempts: 0,
    };

    const updated = await advanceCheckpoint(baseParams.taskId, result);
    expect(updated.completedChunks[0].failedAttempts).toBe(0);
  });

  it("advanceCheckpoint rejects on completed checkpoint", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    // Advance through all chunks to complete
    for (const chunk of baseParams.plan.chunks) {
      await advanceCheckpoint(baseParams.taskId, {
        chunkName: chunk.name,
        status: "completed",
        summary: "Done",
        filesWritten: [],
        durationMs: 1000,
        completedAt: Date.now(),
        failedAttempts: 0,
      });
    }

    // Now try to advance again
    await expect(
      advanceCheckpoint(baseParams.taskId, {
        chunkName: "extra",
        status: "completed",
        summary: "Extra",
        filesWritten: [],
        durationMs: 1000,
        completedAt: Date.now(),
        failedAttempts: 0,
      }),
    ).rejects.toThrow("Cannot advance completed checkpoint");
  });

  it("failChunk increments ChunkResult.failedAttempts for current chunk", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    const updated = await failChunk(baseParams.taskId, "Build error");
    const failedResult = updated.completedChunks.find((r) => r.chunkName === "scaffold");
    expect(failedResult).toBeDefined();
    expect(failedResult!.failedAttempts).toBe(1);
    expect(failedResult!.lastError).toBe("Build error");
  });

  it("failChunk sets status paused when chunk attempts >= maxRetriesPerChunk", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    // Fail 3 times (maxRetriesPerChunk = 3)
    await failChunk(baseParams.taskId, "Error 1");
    await failChunk(baseParams.taskId, "Error 2");
    const updated = await failChunk(baseParams.taskId, "Error 3");
    expect(updated.status).toBe("paused");
  });

  it("failChunk keeps status executing when under max retries", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    const updated = await failChunk(baseParams.taskId, "Error 1");
    expect(updated.status).toBe("executing");
  });

  it("cancelCheckpoint sets status cancelled", async () => {
    await createCheckpoint(baseParams);
    await cancelCheckpoint(baseParams.taskId);
    const checkpoint = await readCheckpoint(baseParams.taskId);
    expect(checkpoint!.status).toBe("cancelled");
  });

  it("pauseCheckpoint sets status paused", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");
    await pauseCheckpoint(baseParams.taskId);
    const checkpoint = await readCheckpoint(baseParams.taskId);
    expect(checkpoint!.status).toBe("paused");
  });

  it("patchCheckpoint updates multiple mutable fields in one write", async () => {
    await createCheckpoint(baseParams);
    await patchCheckpoint(baseParams.taskId, {
      containerId: "jinx-marathon-updated",
      watchdogJobId: "watchdog-1",
      status: "executing",
    });

    const checkpoint = await readCheckpoint(baseParams.taskId);
    expect(checkpoint!.containerId).toBe("jinx-marathon-updated");
    expect(checkpoint!.watchdogJobId).toBe("watchdog-1");
    expect(checkpoint!.status).toBe("executing");
  });

  it("listCheckpoints returns all, or filtered by status", async () => {
    await createCheckpoint(baseParams);
    await createCheckpoint({
      ...baseParams,
      taskId: "test-task-2",
      sessionKey: "marathon:test-task-2",
    });
    await updateCheckpointStatus("test-task-2", "executing");

    const all = await listCheckpoints();
    expect(all).toHaveLength(2);

    const executing = await listCheckpoints({ status: ["executing"] });
    expect(executing).toHaveLength(1);
    expect(executing[0].taskId).toBe("test-task-2");
  });

  it("checkpoint survives JSON round-trip (all fields preserved)", async () => {
    const checkpoint = await createCheckpoint(baseParams);
    const readBack = await readCheckpoint(baseParams.taskId);

    expect(readBack!.taskId).toBe(checkpoint.taskId);
    expect(readBack!.sessionKey).toBe(checkpoint.sessionKey);
    expect(readBack!.containerId).toBe(checkpoint.containerId);
    expect(readBack!.plan.goal).toBe(checkpoint.plan.goal);
    expect(readBack!.plan.chunks).toHaveLength(checkpoint.plan.chunks.length);
    expect(readBack!.deliverTo).toEqual(checkpoint.deliverTo);
    expect(readBack!.originSessionKey).toBe(checkpoint.originSessionKey);
    expect(readBack!.maxRetriesPerChunk).toBe(checkpoint.maxRetriesPerChunk);
  });

  it("state machine: planning → executing → completed", async () => {
    await createCheckpoint(baseParams);
    let cp = await readCheckpoint(baseParams.taskId);
    expect(cp!.status).toBe("planning");

    await updateCheckpointStatus(baseParams.taskId, "executing");
    cp = await readCheckpoint(baseParams.taskId);
    expect(cp!.status).toBe("executing");

    // Advance all chunks
    for (const chunk of baseParams.plan.chunks) {
      await advanceCheckpoint(baseParams.taskId, {
        chunkName: chunk.name,
        status: "completed",
        summary: "Done",
        filesWritten: [],
        durationMs: 1000,
        completedAt: Date.now(),
        failedAttempts: 0,
      });
    }
    cp = await readCheckpoint(baseParams.taskId);
    expect(cp!.status).toBe("completed");
  });

  it("state machine: executing → paused → executing (resume)", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    await pauseCheckpoint(baseParams.taskId);
    let cp = await readCheckpoint(baseParams.taskId);
    expect(cp!.status).toBe("paused");

    await updateCheckpointStatus(baseParams.taskId, "executing");
    cp = await readCheckpoint(baseParams.taskId);
    expect(cp!.status).toBe("executing");
  });

  it("state machine: executing → cancelled (terminal)", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");
    await cancelCheckpoint(baseParams.taskId);
    const cp = await readCheckpoint(baseParams.taskId);
    expect(cp!.status).toBe("cancelled");
  });

  it("state machine: paused → cancelled (terminal)", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");
    await pauseCheckpoint(baseParams.taskId);
    await cancelCheckpoint(baseParams.taskId);
    const cp = await readCheckpoint(baseParams.taskId);
    expect(cp!.status).toBe("cancelled");
  });

  it("resetCurrentChunkRetries resets failedAttempts for the current chunk", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    // Fail the current chunk twice
    await failChunk(baseParams.taskId, "Error 1");
    await failChunk(baseParams.taskId, "Error 2");

    let cp = await readCheckpoint(baseParams.taskId);
    const failedEntry = cp!.completedChunks.find((r) => r.chunkName === "scaffold");
    expect(failedEntry!.failedAttempts).toBe(2);

    // Reset retries
    await resetCurrentChunkRetries(baseParams.taskId);

    cp = await readCheckpoint(baseParams.taskId);
    const resetEntry = cp!.completedChunks.find((r) => r.chunkName === "scaffold");
    expect(resetEntry!.failedAttempts).toBe(0);
  });

  it("resetCurrentChunkRetries is a no-op when no failed entry exists", async () => {
    await createCheckpoint(baseParams);
    await updateCheckpointStatus(baseParams.taskId, "executing");

    // No failures recorded — should not throw
    await resetCurrentChunkRetries(baseParams.taskId);

    const cp = await readCheckpoint(baseParams.taskId);
    expect(cp!.completedChunks).toHaveLength(0);
  });
});
