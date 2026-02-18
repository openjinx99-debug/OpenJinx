/**
 * System test: Marathon Flow — classify → launch → plan → chunk loop → deliver.
 *
 * Only the LLM provider and auth are mocked. Everything else runs for real:
 * real dispatch, real classifier, real checkpoint CRUD, real delivery routing,
 * real streaming, real session store.
 *
 * Container manager is not available (no Apple Container in CI), so the
 * containerManager path is exercised as undefined (the code handles this).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { AgentTurnOptions } from "../providers/types.js";
import { pollUntil } from "../__test__/async.js";
import { buildTestMsgContext } from "../__test__/context.js";
import { createTestHarness } from "../__test__/harness.js";

// ── Mock the LLM provider ──────────────────────────────────────────────

const providerCalls: Array<{ sessionId?: string; prompt: string; model: string }> = [];

const PLAN_RESPONSE = JSON.stringify({
  goal: "Build a simple todo CLI app",
  chunks: [
    {
      name: "scaffold",
      prompt: "Create package.json, tsconfig, and src/index.ts",
      estimatedMinutes: 5,
    },
    {
      name: "core-logic",
      prompt: "Implement todo CRUD operations",
      estimatedMinutes: 10,
    },
    {
      name: "tests",
      prompt: "Write unit tests for todo operations",
      estimatedMinutes: 10,
    },
  ],
});

vi.mock("../providers/claude-provider.js", () => ({
  runAgentTurn: vi.fn(async (options: AgentTurnOptions) => {
    providerCalls.push({
      sessionId: options.sessionId,
      prompt: options.prompt,
      model: options.model,
    });

    // Classifier call
    if (options.sessionId === "classifier") {
      const responseText = JSON.stringify({
        classification: "marathon",
        reason: "multi-step app build requiring scaffolding, implementation, and testing",
      });
      options.onDelta?.(responseText);
      return {
        text: responseText,
        messages: [{ role: "assistant", content: responseText }],
        hitTurnLimit: false,
        usage: {
          inputTokens: 80,
          outputTokens: 20,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        durationMs: 100,
        model: options.model,
      };
    }

    // Planning turn (first non-classifier call for a marathon session)
    if (options.prompt.includes("Decompose this into ordered work chunks")) {
      options.onDelta?.(PLAN_RESPONSE);
      return {
        text: PLAN_RESPONSE,
        messages: [{ role: "assistant", content: PLAN_RESPONSE }],
        hitTurnLimit: false,
        usage: {
          inputTokens: 300,
          outputTokens: 200,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        durationMs: 2000,
        model: options.model,
      };
    }

    // Chunk execution turns
    const chunkMatch = options.prompt.match(/CURRENT CHUNK: (\S+)/);
    const chunkName = chunkMatch ? chunkMatch[1] : "unknown";

    // Write real files into active marathon task workspaces so chunk output
    // verification sees concrete filesystem changes.
    const tasksRoot = path.join(process.env.JINX_HOME ?? os.tmpdir(), "tasks");
    const taskDirs = await fs.readdir(tasksRoot).catch(() => [] as string[]);
    for (const taskDir of taskDirs) {
      if (!taskDir.startsWith("marathon-")) {
        continue;
      }
      const srcDir = path.join(tasksRoot, taskDir, "src");
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(path.join(srcDir, `${chunkName}.ts`), `// ${chunkName} implementation`);
      await fs.writeFile(path.join(srcDir, `${chunkName}.test.ts`), `// ${chunkName} tests`);
    }

    const chunkResponse =
      `Completed chunk ${chunkName}. Created files:\n` +
      `- /workspace/src/${chunkName}.ts\n` +
      `- /workspace/src/${chunkName}.test.ts`;
    options.onDelta?.(chunkResponse);
    return {
      text: chunkResponse,
      messages: [{ role: "assistant", content: chunkResponse }],
      hitTurnLimit: false,
      usage: {
        inputTokens: 200,
        outputTokens: 150,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      durationMs: 3000,
      model: options.model,
    };
  }),
}));

vi.mock("../providers/auth.js", () => ({
  resolveAuth: () => ({ mode: "api-key", key: "test-key-for-system-test" }),
}));

function makeMarathonConfig() {
  return {
    enabled: true,
    maxConcurrent: 1,
    chunkIntervalMs: 0,
    maxChunks: 50,
    maxDurationHours: 12,
    maxRetriesPerChunk: 3,
    container: { cpus: 4, memoryGB: 4, commandTimeoutMs: 600_000 },
    progress: { notifyEveryNChunks: 1, includeFileSummary: true },
  };
}

describe("Marathon flow — system test", () => {
  it("complex build prompt → classify as marathon → plan → chunk loop → deliver results", async () => {
    // Each test gets its own tmpHome to prevent cross-test pollution
    const tmpHome = path.join(os.tmpdir(), `jinx-marathon-sys-${Date.now()}-a`);
    process.env.JINX_HOME = tmpHome;
    await fs.mkdir(path.join(tmpHome, "sessions"), { recursive: true });
    await fs.mkdir(path.join(tmpHome, "marathon"), { recursive: true });
    await fs.mkdir(path.join(tmpHome, "workspace"), { recursive: true });
    providerCalls.length = 0;

    const harness = await createTestHarness({
      channelId: "telegram",
      configOverrides: { marathon: makeMarathonConfig() },
    });

    try {
      const { dispatchInboundMessage } = await import("../pipeline/dispatch.js");
      const { subscribeStream } = await import("../pipeline/streaming.js");

      const channels = new Map([["telegram", harness.channel]]);
      const originSessionKey = "telegram:dm:tg-user-42";
      const streamEvents: Array<{ type: string; text?: string }> = [];
      const unsub = subscribeStream(originSessionKey, (e) => {
        streamEvents.push({
          type: e.type,
          text: "text" in e ? e.text : undefined,
        });
      });

      const ctx = buildTestMsgContext({
        channel: "telegram",
        senderId: "tg-user-42",
        senderName: "Tommy",
        text: "Build me a complete todo CLI app with TypeScript — project setup, CRUD operations, and full test suite.",
      });

      // Dispatch through the full pipeline
      const result = await dispatchInboundMessage(ctx, {
        config: harness.config,
        sessions: harness.sessions,
        channels,
      });

      // Dispatch returns empty text (marathon is fire-and-forget)
      expect(result.text).toBe("");

      // ── Verify classifier was called and returned "marathon" ──
      const classifierCall = providerCalls.find((c) => c.sessionId === "classifier");
      expect(classifierCall).toBeDefined();

      // ── Verify ack was emitted on origin session ──
      const ackEvent = streamEvents.find(
        (e) => e.type === "final" && e.text?.includes("Starting marathon task"),
      );
      expect(ackEvent).toBeDefined();

      // ── Wait for marathon to complete (plan + 3 chunks) ──
      // The completion message contains "complete!" — wait for it
      await pollUntil(
        () => {
          const texts = harness.channel.deliveries.map((d) => d.payload.text);
          return texts.some((t) => t.includes("complete!"));
        },
        { intervalMs: 100, timeoutMs: 30_000 },
      );

      // ── Verify the planning turn was called ──
      const planCall = providerCalls.find((c) =>
        c.prompt.includes("Decompose this into ordered work chunks"),
      );
      expect(planCall).toBeDefined();

      // ── Verify chunk execution turns happened ──
      const chunkCalls = providerCalls.filter((c) => c.prompt.includes("CURRENT CHUNK:"));
      expect(chunkCalls).toHaveLength(3);

      const chunkNames = chunkCalls.map((c) => {
        const match = c.prompt.match(/CURRENT CHUNK: (\S+)/);
        return match ? match[1] : "";
      });
      expect(chunkNames).toContain("scaffold");
      expect(chunkNames).toContain("core-logic");
      expect(chunkNames).toContain("tests");

      // ── Verify progress updates were delivered via channel ──
      const allDelivered = harness.channel.deliveries.map((d) => d.payload.text);
      const planDelivery = allDelivered.find((t) => t.includes("Marathon plan for"));
      expect(planDelivery).toBeDefined();
      expect(planDelivery).toContain("scaffold");

      // ── Verify completion message was delivered ──
      const completionDelivery = allDelivered.find((t) => t.includes("complete!"));
      expect(completionDelivery).toBeDefined();
      expect(completionDelivery).toContain("**Chunks completed:** 3");

      // ── Verify marathon session was created ──
      const allSessions = harness.sessions.list();
      const marathonSession = allSessions.find((s) => s.sessionKey.startsWith("marathon:"));
      expect(marathonSession).toBeDefined();
      expect(marathonSession!.parentSessionKey).toBe(originSessionKey);
      expect(marathonSession!.channel).toBe("telegram");

      // ── Verify checkpoint was written to disk ──
      const marathonDir = path.join(tmpHome, "marathon");
      const checkpointFiles = await fs.readdir(marathonDir);
      const jsonFiles = checkpointFiles.filter((f) => f.endsWith(".json"));
      expect(jsonFiles).toHaveLength(1);

      const cpData = JSON.parse(await fs.readFile(path.join(marathonDir, jsonFiles[0]), "utf-8"));
      expect(cpData.status).toBe("completed");
      expect(cpData.completedChunks).toHaveLength(3);
      expect(cpData.currentChunkIndex).toBe(3);
      expect(cpData.originSessionKey).toBe(originSessionKey);

      // ── Verify chunk context passing (each chunk sees prior summaries) ──
      const coreLogicCall = chunkCalls.find((c) => c.prompt.includes("CURRENT CHUNK: core-logic"));
      expect(coreLogicCall).toBeDefined();
      expect(coreLogicCall!.prompt).toContain("scaffold"); // Prior chunk summary

      const testsCall = chunkCalls.find((c) => c.prompt.includes("CURRENT CHUNK: tests"));
      expect(testsCall).toBeDefined();
      expect(testsCall!.prompt).toContain("scaffold");
      expect(testsCall!.prompt).toContain("core-logic");

      unsub();
    } finally {
      await harness.cleanup();
      delete process.env.JINX_HOME;
      await fs.rm(tmpHome, { recursive: true, force: true });
    }
  });

  it("short message is NOT classified as marathon", async () => {
    const tmpHome = path.join(os.tmpdir(), `jinx-marathon-sys-${Date.now()}-b`);
    process.env.JINX_HOME = tmpHome;
    await fs.mkdir(path.join(tmpHome, "sessions"), { recursive: true });
    providerCalls.length = 0;

    const harness = await createTestHarness({
      channelId: "telegram",
      configOverrides: { marathon: makeMarathonConfig() },
    });

    try {
      const { dispatchInboundMessage } = await import("../pipeline/dispatch.js");
      const channels = new Map([["telegram", harness.channel]]);

      const ctx = buildTestMsgContext({
        channel: "telegram",
        senderId: "tg-user-42",
        senderName: "Tommy",
        text: "hey jinx",
      });

      await dispatchInboundMessage(ctx, {
        config: harness.config,
        sessions: harness.sessions,
        channels,
      });

      // Short message (<20 chars) — classifier should NOT be called
      const classifierCall = providerCalls.find((c) => c.sessionId === "classifier");
      expect(classifierCall).toBeUndefined();

      // No marathon session created
      const allSessions = harness.sessions.list();
      const marathonSession = allSessions.find((s) => s.sessionKey.startsWith("marathon:"));
      expect(marathonSession).toBeUndefined();
    } finally {
      await harness.cleanup();
      delete process.env.JINX_HOME;
      await fs.rm(tmpHome, { recursive: true, force: true });
    }
  });

  it("marathon disabled in config → downgrades to deep work", async () => {
    const tmpHome = path.join(os.tmpdir(), `jinx-marathon-sys-${Date.now()}-c`);
    process.env.JINX_HOME = tmpHome;
    await fs.mkdir(path.join(tmpHome, "sessions"), { recursive: true });
    providerCalls.length = 0;

    const harness = await createTestHarness({
      channelId: "telegram",
      configOverrides: { marathon: { ...makeMarathonConfig(), enabled: false } },
    });

    try {
      const { dispatchInboundMessage } = await import("../pipeline/dispatch.js");
      const { subscribeStream } = await import("../pipeline/streaming.js");

      const channels = new Map([["telegram", harness.channel]]);
      const sessionKey = "telegram:dm:tg-user-42";
      const streamEvents: Array<{ type: string; text?: string }> = [];
      const unsub = subscribeStream(sessionKey, (e) => {
        streamEvents.push({
          type: e.type,
          text: "text" in e ? e.text : undefined,
        });
      });

      const ctx = buildTestMsgContext({
        channel: "telegram",
        senderId: "tg-user-42",
        senderName: "Tommy",
        text: "Build me a complete todo CLI app with TypeScript — project setup, CRUD operations, and full test suite.",
      });

      await dispatchInboundMessage(ctx, {
        config: harness.config,
        sessions: harness.sessions,
        channels,
      });

      // Wait for deep work ack
      await pollUntil(
        () => streamEvents.some((e) => e.type === "final" && e.text?.includes("Working on this")),
        { intervalMs: 50, timeoutMs: 5_000 },
      );

      // Deep work session creation is async (after the ack), so wait for it.
      await pollUntil(
        () => harness.sessions.list().some((s) => s.sessionKey.startsWith("deepwork:")),
        { intervalMs: 50, timeoutMs: 5_000 },
      );

      // Should NOT create a marathon session (downgraded to deep)
      const allSessions = harness.sessions.list();
      const marathonSession = allSessions.find((s) => s.sessionKey.startsWith("marathon:"));
      expect(marathonSession).toBeUndefined();

      const deepSession = allSessions.find((s) => s.sessionKey.startsWith("deepwork:"));
      expect(deepSession).toBeDefined();

      unsub();
    } finally {
      await harness.cleanup();
      delete process.env.JINX_HOME;
      await fs.rm(tmpHome, { recursive: true, force: true });
    }
  });
});
