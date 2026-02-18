/**
 * Integration: Marathon executor loop — real checkpoint CRUD, real session store,
 * real delivery routing, real streaming. Only runAgent is mocked (canned responses).
 *
 * This tests the actual executeMarathon → runChunkLoop flow with real state transitions,
 * verifying chunks advance, context accumulates, and completion fires properly.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnOptions } from "../providers/types.js";
import type { SessionEntry, SessionStore } from "../types/sessions.js";
import { pollUntil } from "../__test__/async.js";
import { createTestConfig } from "../__test__/config.js";
import { createMockChannel } from "../__test__/mock-channel.js";

// ── Mock only the LLM provider ──────────────────────────────────────────

const agentCalls: Array<{ prompt: string; tier: string; sessionKey?: string }> = [];
let _chunkCallCount = 0;
let shouldFailChunks = false;

/** Standard mock handler — shared across tests, restored in beforeEach. */
async function standardAgentHandler(options: AgentTurnOptions) {
  agentCalls.push({
    prompt: options.prompt,
    tier: options.model,
    sessionKey: options.sessionId,
  });

  // Planning turn
  if (options.prompt.includes("Decompose this into ordered work chunks")) {
    const plan = JSON.stringify({
      goal: "Build a calculator",
      chunks: [
        { name: "setup", prompt: "Create project structure", estimatedMinutes: 5 },
        { name: "logic", prompt: "Implement calculator logic", estimatedMinutes: 10 },
        { name: "tests", prompt: "Write tests", estimatedMinutes: 5 },
      ],
    });
    options.onDelta?.(plan);
    return {
      text: plan,
      messages: [{ role: "assistant", content: plan }],
      hitTurnLimit: false,
      usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 500,
      model: options.model,
    };
  }

  // Chunk execution
  _chunkCallCount++;
  if (shouldFailChunks) {
    throw new Error("Simulated agent failure");
  }

  const match = options.prompt.match(/CURRENT CHUNK: (\S+)/);
  const name = match ? match[1] : "unknown";

  // Write a real file to the workspace so verifyChunkOutput passes
  const tasksDir = path.join(tmpHome, "tasks");
  const entries = await fs.readdir(tasksDir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (typeof entry === "string" && entry.startsWith("marathon-")) {
      await fs.writeFile(path.join(tasksDir, entry, `${name}.ts`), `// ${name} chunk output`);
    }
  }

  const text = `Done: ${name}. Created /workspace/${name}.ts`;
  options.onDelta?.(text);
  return {
    text,
    messages: [{ role: "assistant", content: text }],
    hitTurnLimit: false,
    usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
    durationMs: 200,
    model: options.model,
  };
}

vi.mock("../providers/claude-provider.js", () => ({
  runAgentTurn: vi.fn(standardAgentHandler),
}));

vi.mock("../providers/auth.js", () => ({
  resolveAuth: () => ({ mode: "api-key", key: "test-key" }),
}));

let tmpHome: string;
let sessions: SessionStore;
let channel: ReturnType<typeof createMockChannel>;

beforeEach(async () => {
  tmpHome = path.join(os.tmpdir(), `jinx-marathon-exec-${Date.now()}`);
  process.env.JINX_HOME = tmpHome;
  await fs.mkdir(path.join(tmpHome, "sessions"), { recursive: true });
  await fs.mkdir(path.join(tmpHome, "marathon"), { recursive: true });
  await fs.mkdir(path.join(tmpHome, "workspace"), { recursive: true });
  agentCalls.length = 0;
  _chunkCallCount = 0;
  shouldFailChunks = false;

  // Restore standard mock handler (cancel test overrides it)
  const { runAgentTurn } = await import("../providers/claude-provider.js");
  vi.mocked(runAgentTurn).mockImplementation(standardAgentHandler);

  const entries = new Map<string, SessionEntry>();
  sessions = {
    get: (key) => entries.get(key),
    set: (key, entry) => entries.set(key, entry),
    delete: (key) => entries.delete(key),
    list: () => [...entries.values()],
    save: async () => {},
    load: async () => {},
  };
  channel = createMockChannel("telegram");
});

const { launchMarathon, resumeMarathon, cancelMarathon, isExecutorAlive } =
  await import("../pipeline/marathon.js");
const { readCheckpoint, listCheckpoints } = await import("../pipeline/checkpoint.js");

function makeDeps() {
  const config = createTestConfig({
    marathon: {
      enabled: true,
      maxConcurrent: 2,
      chunkIntervalMs: 0,
      maxChunks: 50,
      maxDurationHours: 12,
      maxRetriesPerChunk: 2,
      container: { cpus: 4, memoryGB: 4, commandTimeoutMs: 600_000 },
      progress: { notifyEveryNChunks: 1, includeFileSummary: true },
    },
  });
  return {
    config,
    sessions,
    channels: new Map([["telegram", channel]]),
  };
}

describe("marathon executor integration", () => {
  it("full loop: plan → 3 chunks → completed checkpoint + delivery", async () => {
    const deps = makeDeps();
    launchMarathon(
      {
        prompt: "Build me a calculator app",
        originSessionKey: "telegram:dm:user1",
        deliveryTarget: { channel: "telegram", to: "user1" },
        channel: "telegram",
        senderName: "Tommy",
      },
      deps,
    );

    // Wait for completion delivery
    await pollUntil(() => channel.deliveries.some((d) => d.payload.text.includes("complete!")), {
      intervalMs: 50,
      timeoutMs: 15_000,
    });

    // Verify planning turn used correct tier (opus = brain)
    const planCall = agentCalls.find((c) => c.prompt.includes("Decompose this"));
    expect(planCall).toBeDefined();

    // Verify 3 chunk turns executed
    const chunkTurns = agentCalls.filter((c) => c.prompt.includes("CURRENT CHUNK:"));
    expect(chunkTurns).toHaveLength(3);

    // Verify checkpoint on disk is "completed"
    const checkpoints = await listCheckpoints();
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].status).toBe("completed");
    expect(checkpoints[0].completedChunks).toHaveLength(3);
    expect(checkpoints[0].currentChunkIndex).toBe(3);

    // Verify each chunk result has correct data
    expect(checkpoints[0].completedChunks[0].chunkName).toBe("setup");
    expect(checkpoints[0].completedChunks[1].chunkName).toBe("logic");
    expect(checkpoints[0].completedChunks[2].chunkName).toBe("tests");

    // Verify context accumulates (chunk 3 prompt includes prior summaries)
    const testsChunk = chunkTurns.find((c) => c.prompt.includes("CURRENT CHUNK: tests"));
    expect(testsChunk!.prompt).toContain("setup");
    expect(testsChunk!.prompt).toContain("logic");

    // Verify delivery happened
    const completionMsg = channel.deliveries.find((d) => d.payload.text.includes("complete!"));
    expect(completionMsg).toBeDefined();
    expect(completionMsg!.to).toBe("user1");
  });

  it("chunk failure retries then pauses at maxRetriesPerChunk", async () => {
    shouldFailChunks = true; // Fail every chunk call (simulates persistent failure)

    const deps = makeDeps();
    launchMarathon(
      {
        prompt: "Build me a calculator app",
        originSessionKey: "telegram:dm:user2",
        deliveryTarget: { channel: "telegram", to: "user2" },
        channel: "telegram",
        senderName: "Tommy",
      },
      deps,
    );

    // Wait for pause notification
    await pollUntil(() => channel.deliveries.some((d) => d.payload.text.includes("paused")), {
      intervalMs: 50,
      timeoutMs: 15_000,
    });

    // Verify checkpoint is paused
    const checkpoints = await listCheckpoints({ status: ["paused"] });
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].status).toBe("paused");
    expect(checkpoints[0].currentChunkIndex).toBe(0); // Still on first chunk

    // Verify executor is no longer active
    expect(isExecutorAlive(checkpoints[0].taskId)).toBe(false);
  });

  it("cancelMarathon stops active executor and marks cancelled", async () => {
    // Make chunk execution slow so we can cancel mid-flight
    const originalMock = vi.mocked((await import("../providers/claude-provider.js")).runAgentTurn);
    let resolveBlockedChunk: (() => void) | undefined;

    originalMock.mockImplementation(async (options: AgentTurnOptions) => {
      agentCalls.push({ prompt: options.prompt, tier: options.model });

      if (options.prompt.includes("Decompose this")) {
        const plan = JSON.stringify({
          goal: "Blocked task",
          chunks: [
            { name: "slow-chunk", prompt: "Do slow work", estimatedMinutes: 60 },
            { name: "never-reached", prompt: "Should not run", estimatedMinutes: 5 },
          ],
        });
        options.onDelta?.(plan);
        return {
          text: plan,
          messages: [],
          hitTurnLimit: false,
          usage: {
            inputTokens: 10,
            outputTokens: 10,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
          },
          durationMs: 100,
          model: options.model,
        };
      }

      // Block on chunk execution until cancelled
      await new Promise<void>((resolve) => {
        resolveBlockedChunk = resolve;
      });
      const text = "Done";
      return {
        text,
        messages: [],
        hitTurnLimit: false,
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        durationMs: 100,
        model: options.model,
      };
    });

    const deps = makeDeps();
    launchMarathon(
      {
        prompt: "Build something slow",
        originSessionKey: "telegram:dm:user3",
        deliveryTarget: { channel: "telegram", to: "user3" },
        channel: "telegram",
        senderName: "Tommy",
      },
      deps,
    );

    // Wait for chunk loop to start (plan summary delivered)
    await pollUntil(
      () => channel.deliveries.some((d) => d.payload.text.includes("Marathon plan for")),
      { intervalMs: 50, timeoutMs: 10_000 },
    );

    // Find the task ID from the checkpoint
    const active = await listCheckpoints({ status: ["executing"] });
    expect(active).toHaveLength(1);
    const taskId = active[0].taskId;
    expect(isExecutorAlive(taskId)).toBe(true);

    // Cancel it
    await cancelMarathon(taskId, deps);

    // Unblock the stuck chunk so the loop can exit
    resolveBlockedChunk?.();
    await new Promise((r) => setTimeout(r, 100));

    // Verify cancelled
    const cp = await readCheckpoint(taskId);
    expect(cp!.status).toBe("cancelled");
    expect(isExecutorAlive(taskId)).toBe(false);
  });

  it("resumeMarathon restarts from last checkpoint", async () => {
    const deps = makeDeps();

    // Run a marathon that will pause after persistent chunk failures
    shouldFailChunks = true;

    launchMarathon(
      {
        prompt: "Build me a calculator app",
        originSessionKey: "telegram:dm:user4",
        deliveryTarget: { channel: "telegram", to: "user4" },
        channel: "telegram",
        senderName: "Tommy",
      },
      deps,
    );

    // Wait for pause
    await pollUntil(() => channel.deliveries.some((d) => d.payload.text.includes("paused")), {
      intervalMs: 50,
      timeoutMs: 15_000,
    });

    const paused = await listCheckpoints({ status: ["paused"] });
    expect(paused).toHaveLength(1);
    const taskId = paused[0].taskId;

    // Fix the failure and resume
    shouldFailChunks = false;
    _chunkCallCount = 0;
    channel.reset();

    // Small delay to ensure the paused executor loop has fully exited
    await new Promise((r) => setTimeout(r, 100));

    await resumeMarathon(taskId, deps);

    // Wait for completion — resumeMarathon fires chunk loop in background
    await pollUntil(
      () => {
        const cp = channel.deliveries.find((d) => d.payload.text.includes("complete!"));
        return cp !== undefined;
      },
      { intervalMs: 100, timeoutMs: 30_000 },
    );

    // Verify completed
    const cp = await readCheckpoint(taskId);
    expect(cp!.status).toBe("completed");
    // completedChunks includes the failed attempts (1 failed "setup") + 3 completed
    const successful = cp!.completedChunks.filter(
      (c: { status: string }) => c.status === "completed",
    );
    expect(successful).toHaveLength(3);
    expect(cp!.currentChunkIndex).toBe(3);
  });

  it("watchdog detects dead executor and resumes marathon", async () => {
    const deps = makeDeps();

    // Launch a marathon that will pause (persistent failures)
    shouldFailChunks = true;
    launchMarathon(
      {
        prompt: "Build me a calculator app",
        originSessionKey: "telegram:dm:user5",
        deliveryTarget: { channel: "telegram", to: "user5" },
        channel: "telegram",
        senderName: "Tommy",
      },
      deps,
    );

    // Wait for pause
    await pollUntil(() => channel.deliveries.some((d) => d.payload.text.includes("paused")), {
      intervalMs: 50,
      timeoutMs: 15_000,
    });

    const paused = await listCheckpoints({ status: ["paused"] });
    expect(paused).toHaveLength(1);
    const taskId = paused[0].taskId;

    // Executor should no longer be alive
    expect(isExecutorAlive(taskId)).toBe(false);

    // Simulate watchdog: detect dead executor + resume
    shouldFailChunks = false;
    channel.reset();
    await new Promise((r) => setTimeout(r, 100));

    // This is the watchdog path: isExecutorAlive returns false → resume
    if (!isExecutorAlive(taskId)) {
      await resumeMarathon(taskId, deps);
    }

    // Wait for completion
    await pollUntil(() => channel.deliveries.some((d) => d.payload.text.includes("complete!")), {
      intervalMs: 100,
      timeoutMs: 30_000,
    });

    const cp = await readCheckpoint(taskId);
    expect(cp!.status).toBe("completed");
  });

  it("completion delivers ZIP attachment when workspace has files", async () => {
    const deps = makeDeps();

    // Create real files in the workspace that the marathon will use
    // We need to intercept the workspace dir creation and write files there
    const workspaceDirs: string[] = [];
    const origMkdir = fs.mkdir;
    const mkdirSpy = vi.spyOn(fs, "mkdir").mockImplementation(async (p, opts) => {
      const dirPath = String(p);
      if (dirPath.includes("marathon-")) {
        workspaceDirs.push(dirPath);
      }
      return origMkdir(p, opts);
    });

    launchMarathon(
      {
        prompt: "Build me a calculator app",
        originSessionKey: "telegram:dm:user6",
        deliveryTarget: { channel: "telegram", to: "user6" },
        channel: "telegram",
        senderName: "Tommy",
      },
      deps,
    );

    // Wait for plan summary (workspace dir has been created by then)
    await pollUntil(
      () => channel.deliveries.some((d) => d.payload.text.includes("Marathon plan for")),
      { intervalMs: 50, timeoutMs: 10_000 },
    );

    // Write real files into the workspace directory
    const workspaceDir = workspaceDirs.find((d) => d.includes("tasks/marathon-"));
    expect(workspaceDir).toBeDefined();
    await fs.writeFile(path.join(workspaceDir!, "index.ts"), "console.log('hello');");
    await fs.writeFile(path.join(workspaceDir!, "package.json"), '{"name":"test"}');

    // Wait for completion
    await pollUntil(() => channel.deliveries.some((d) => d.payload.text.includes("complete!")), {
      intervalMs: 100,
      timeoutMs: 30_000,
    });

    mkdirSpy.mockRestore();

    // deliverOutboundPayloads sends text and media as separate channel.send() calls
    // The completion text is one delivery, the ZIP is a separate delivery with media
    const completionTextDelivery = channel.deliveries.find((d) =>
      d.payload.text?.includes("complete!"),
    );
    expect(completionTextDelivery).toBeDefined();

    // Find the media delivery (separate call with no text, only media)
    const mediaDelivery = channel.deliveries.find(
      (d) => d.payload.media && d.payload.media.length > 0,
    );
    expect(mediaDelivery).toBeDefined();
    expect(mediaDelivery!.payload.media![0].type).toBe("document");
    expect(mediaDelivery!.payload.media![0].mimeType).toBe("application/zip");
    expect(mediaDelivery!.payload.media![0].filename).toContain(".zip");
  });
});
