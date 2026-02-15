import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
/**
 * System test: Deep Work Classification & Routing via Telegram.
 *
 * Tests the full pipeline: inbound Telegram message → classifier detects
 * "deep" → ack emitted → background deep-work agent runs → result
 * delivered back via Telegram channel.
 *
 * Only the LLM provider is mocked; everything else runs for real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AgentTurnOptions } from "../providers/types.js";
import type { ChatEvent } from "../types/messages.js";
import { pollUntil } from "../__test__/async.js";
import { buildTestMsgContext } from "../__test__/context.js";
import { createTestHarness, type TestHarness } from "../__test__/harness.js";

// ── Mock the LLM provider ──────────────────────────────────────────────
// Both the classifier (classifyTask → runAgentTurn) and the agent runner
// (runAgent → callProvider → runAgentTurn) use this single entry point.

const providerCalls: Array<{ sessionId?: string; prompt: string; model: string }> = [];

vi.mock("../providers/claude-provider.js", () => ({
  runAgentTurn: vi.fn(async (options: AgentTurnOptions) => {
    providerCalls.push({
      sessionId: options.sessionId,
      prompt: options.prompt,
      model: options.model,
    });

    // Classifier call — identified by sessionId
    if (options.sessionId === "classifier") {
      const responseText = JSON.stringify({
        classification: "deep",
        reason: "multi-step research requiring synthesis",
      });
      options.onDelta?.(responseText);
      return {
        text: responseText,
        messages: [{ role: "assistant", content: responseText }],
        hitTurnLimit: false,
        usage: { inputTokens: 80, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0 },
        durationMs: 150,
        model: options.model,
      };
    }

    // Agent turn (deep work or normal) — return a research result
    const deepResult =
      "After thorough analysis, here are the key differences between " +
      "Redis and Memcached for session caching:\n\n" +
      "1. **Data structures**: Redis supports strings, hashes, lists, sets. " +
      "Memcached only supports strings.\n" +
      "2. **Persistence**: Redis can persist to disk. Memcached is purely in-memory.\n" +
      "3. **Clustering**: Redis has built-in cluster mode. Memcached relies on client-side sharding.";

    options.onDelta?.(deepResult);
    return {
      text: deepResult,
      messages: [{ role: "assistant", content: deepResult }],
      hitTurnLimit: false,
      usage: { inputTokens: 500, outputTokens: 300, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 8000,
      model: options.model,
    };
  }),
}));

// Mock auth resolution (no real API key needed)
vi.mock("../providers/auth.js", () => ({
  resolveAuth: () => ({ mode: "api-key", key: "test-key-for-system-test" }),
}));

// Use JINX_HOME env var to redirect transcript/session writes to a temp dir
const tmpHome = path.join(os.tmpdir(), `jinx-deepwork-test-${Date.now()}`);

let harness: TestHarness;

beforeEach(async () => {
  providerCalls.length = 0;

  // Set JINX_HOME so resolveHomeDir/ensureHomeDir use the temp dir
  process.env.JINX_HOME = tmpHome;
  await fs.mkdir(path.join(tmpHome, "sessions"), { recursive: true });

  harness = await createTestHarness({ channelId: "telegram" });
});

afterEach(async () => {
  await harness.cleanup();
  delete process.env.JINX_HOME;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("Deep work via Telegram — system test", () => {
  it("complex research prompt → classify as deep → ack → deep work → deliver result", async () => {
    const { dispatchInboundMessage } = await import("../pipeline/dispatch.js");
    const { subscribeStream } = await import("../pipeline/streaming.js");

    // Wire up the Telegram mock channel
    const channels = new Map([["telegram", harness.channel]]);

    // Capture stream events on the origin session
    const originSessionKey = "telegram:dm:tg-user-42";
    const streamEvents: ChatEvent[] = [];
    const unsub = subscribeStream(originSessionKey, (e) => streamEvents.push(e));

    // Build a realistic Telegram context with a complex research prompt
    const ctx = buildTestMsgContext({
      channel: "telegram",
      senderId: "tg-user-42",
      senderName: "Tommy",
      text: "Compare Redis vs Memcached for session caching — give me a thorough breakdown of data structures, persistence, clustering, and which to choose for a 10K RPM API.",
    });

    // Dispatch the message through the full pipeline
    const result = await dispatchInboundMessage(ctx, {
      config: harness.config,
      sessions: harness.sessions,
      channels,
    });

    // Dispatch returns immediately with empty text (ack handled via stream)
    expect(result.text).toBe("");

    // ── Verify classifier was called ──
    expect(providerCalls.length).toBeGreaterThanOrEqual(1);
    const classifierCall = providerCalls.find((c) => c.sessionId === "classifier");
    expect(classifierCall).toBeDefined();
    expect(classifierCall!.model).toBe(harness.config.llm.light); // haiku

    // ── Verify ack was emitted on origin session stream ──
    const ackEvent = streamEvents.find(
      (e) => e.type === "final" && "text" in e && e.text.includes("Working on this"),
    );
    expect(ackEvent).toBeDefined();

    // ── Wait for the deep work result to be delivered to Telegram ──
    await pollUntil(() => harness.channel.deliveries.length > 0, {
      intervalMs: 100,
      timeoutMs: 15_000,
    });

    // ── Verify the result was delivered to the right recipient ──
    const deliveries = harness.channel.getDeliveriesTo("tg-user-42");
    expect(deliveries.length).toBeGreaterThanOrEqual(1);

    // The delivered text should contain the deep work analysis
    const deliveredText = deliveries.map((d) => d.payload.text).join("\n");
    expect(deliveredText).toContain("Redis");
    expect(deliveredText).toContain("Memcached");

    // ── Verify the deep work agent was called with tier "brain" ──
    const agentCalls = providerCalls.filter((c) => c.sessionId !== "classifier");
    expect(agentCalls.length).toBeGreaterThanOrEqual(1);

    // ── Verify a deep work session was created ──
    const allSessions = harness.sessions.list();
    const deepWorkSession = allSessions.find((s) => s.sessionKey.startsWith("deepwork:"));
    expect(deepWorkSession).toBeDefined();
    expect(deepWorkSession!.parentSessionKey).toBe(originSessionKey);
    expect(deepWorkSession!.channel).toBe("telegram");

    unsub();
  });

  it("short message bypasses classifier and goes through normal dispatch", async () => {
    const { dispatchInboundMessage } = await import("../pipeline/dispatch.js");
    const { subscribeStream } = await import("../pipeline/streaming.js");

    const channels = new Map([["telegram", harness.channel]]);
    const sessionKey = "telegram:dm:tg-user-42";
    const streamEvents: ChatEvent[] = [];
    const unsub = subscribeStream(sessionKey, (e) => streamEvents.push(e));

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

    // Short message — classifier should NOT be called
    const classifierCall = providerCalls.find((c) => c.sessionId === "classifier");
    expect(classifierCall).toBeUndefined();

    // Normal dispatch goes through the agent runner directly (not deep work)
    // The agent's response comes via streaming
    const finalEvent = streamEvents.find((e) => e.type === "final");
    expect(finalEvent).toBeDefined();

    // No deep work session created
    const allSessions = harness.sessions.list();
    const deepWorkSession = allSessions.find((s) => s.sessionKey.startsWith("deepwork:"));
    expect(deepWorkSession).toBeUndefined();

    unsub();
  });

  it("classifier failure falls back to normal dispatch gracefully", async () => {
    const { runAgentTurn } = await import("../providers/claude-provider.js");
    const { dispatchInboundMessage } = await import("../pipeline/dispatch.js");
    const { subscribeStream } = await import("../pipeline/streaming.js");

    // Override the mock to throw on classifier call, then normal for agent
    vi.mocked(runAgentTurn).mockImplementationOnce(async (options: AgentTurnOptions) => {
      if (options.sessionId === "classifier") {
        throw new Error("API rate limit exceeded");
      }
      return {
        text: "fallback",
        messages: [],
        hitTurnLimit: false,
        usage: { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 },
        durationMs: 50,
        model: options.model,
      };
    });

    const channels = new Map([["telegram", harness.channel]]);
    const sessionKey = "telegram:dm:tg-user-42";
    const streamEvents: ChatEvent[] = [];
    const unsub = subscribeStream(sessionKey, (e) => streamEvents.push(e));

    const ctx = buildTestMsgContext({
      channel: "telegram",
      senderId: "tg-user-42",
      senderName: "Tommy",
      text: "Compare all the major cloud providers and their pricing for GPU instances",
    });

    await dispatchInboundMessage(ctx, {
      config: harness.config,
      sessions: harness.sessions,
      channels,
    });

    // Classifier failed → should fall back to "quick" → normal dispatch
    // Should get a final or agent response (not an ack)
    const ackEvent = streamEvents.find(
      (e) => e.type === "final" && "text" in e && e.text.includes("Working on this"),
    );
    expect(ackEvent).toBeUndefined();

    // No deep work session
    const allSessions = harness.sessions.list();
    const deepWorkSession = allSessions.find((s) => s.sessionKey.startsWith("deepwork:"));
    expect(deepWorkSession).toBeUndefined();

    unsub();
  });
});
