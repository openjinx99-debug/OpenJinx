/**
 * Live E2E test: Full pipeline from auth through to LLM response.
 *
 * Verifies the complete chain:
 *   Auth resolution → Model resolution → System prompt assembly →
 *   Claude API call → Text response → Token usage tracking
 *
 * Run: cd jinx && pnpm test:live
 *
 * Prerequisites:
 *   - Claude Code logged in (macOS Keychain), OR
 *   - CLAUDE_CODE_OAUTH_TOKEN env var set, OR
 *   - ANTHROPIC_API_KEY env var set
 *
 * This test makes real API calls and costs a small amount per run.
 * It uses Haiku (cheapest model) to minimize cost.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AgentToolDefinition } from "../providers/types.js";
import { buildSystemPrompt, buildSystemPromptBlocks } from "../agents/system-prompt.js";
import { MemorySearchManager } from "../memory/search-manager.js";
import { hasAuth } from "../providers/auth.js";
import { runAgentTurn } from "../providers/claude-provider.js";

const describeIf = hasAuth() ? describe : describe.skip;

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jinx-live-e2e-"));
});

afterAll(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

/** Minimal workspace files for testing. */
function makeWorkspaceFiles() {
  return [
    {
      name: "SOUL.md" as const,
      path: "/test/SOUL.md",
      content: "# Soul\n\nYou are a helpful assistant. Be concise.",
      missing: false,
    },
    {
      name: "IDENTITY.md" as const,
      path: "/test/IDENTITY.md",
      content: "# Identity\n\nName: Jinx",
      missing: false,
    },
  ];
}

/** A single tool to verify tool execution works. */
function makeTestTool(): AgentToolDefinition {
  return {
    name: "get_current_time",
    description: "Returns the current UTC time as an ISO string.",
    inputSchema: { type: "object", properties: {}, required: [] },
    execute: async () => new Date().toISOString(),
  };
}

describeIf("E2E pipeline (live API)", () => {
  it("auth resolves without error", () => {
    // This is the first prerequisite — if auth fails, nothing else works
    expect(hasAuth()).toBe(true);
  });

  it("single-turn text response from Haiku", async () => {
    const workspaceFiles = makeWorkspaceFiles();
    const systemPrompt = buildSystemPrompt({
      workspaceFiles,
      tools: [],
      sessionType: "main",
      agentName: "Jinx",
      model: "claude-haiku-4-5-20251001",
      workspaceDir: "/test",
      memoryDir: "/test/memory",
    });

    const result = await runAgentTurn({
      prompt: "Reply with exactly the word: PONG",
      systemPrompt,
      model: "haiku",
      maxTurns: 1,
    });

    expect(result.text).toBeTruthy();
    expect(result.text.toUpperCase()).toContain("PONG");
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.hitTurnLimit).toBe(false);

    console.log(
      `  Haiku single-turn: ${result.usage.inputTokens}in/${result.usage.outputTokens}out in ${result.durationMs}ms`,
    );
  });

  it("tool use: agent calls a tool and returns result", async () => {
    const tool = makeTestTool();
    const workspaceFiles = makeWorkspaceFiles();
    const blocks = buildSystemPromptBlocks({
      workspaceFiles,
      tools: [tool],
      sessionType: "main",
      agentName: "Jinx",
      model: "claude-haiku-4-5-20251001",
      workspaceDir: "/test",
      memoryDir: "/test/memory",
    });
    const systemPrompt = blocks
      .map((b) => b.text)
      .filter(Boolean)
      .join("\n\n---\n\n");

    const result = await runAgentTurn({
      prompt: "Use the get_current_time tool and tell me the current time.",
      systemPrompt,
      systemPromptBlocks: blocks,
      model: "haiku",
      tools: [tool],
      maxTurns: 3,
    });

    // Agent should have used the tool and then provided a text response
    expect(result.text).toBeTruthy();
    const toolCalls = result.messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.toolCalls ?? []);
    expect(toolCalls.some((c) => c.name === "get_current_time")).toBe(true);

    console.log(
      `  Tool use: ${toolCalls.length} tool call(s), ${result.usage.inputTokens}in/${result.usage.outputTokens}out in ${result.durationMs}ms`,
    );
  });

  it("streaming: onDelta receives text chunks", async () => {
    const workspaceFiles = makeWorkspaceFiles();
    const systemPrompt = buildSystemPrompt({
      workspaceFiles,
      tools: [],
      sessionType: "main",
      agentName: "Jinx",
      model: "claude-haiku-4-5-20251001",
      workspaceDir: "/test",
      memoryDir: "/test/memory",
    });

    const deltas: string[] = [];

    const result = await runAgentTurn({
      prompt: "Count from 1 to 5, separated by commas.",
      systemPrompt,
      model: "haiku",
      maxTurns: 1,
      onDelta: (text) => deltas.push(text),
    });

    expect(result.text).toBeTruthy();
    // Streaming should have produced multiple delta chunks
    expect(deltas.length).toBeGreaterThan(0);
    // Concatenated deltas should equal the final text
    expect(deltas.join("")).toBe(result.text);

    console.log(`  Streaming: ${deltas.length} delta chunks for ${result.text.length} chars`);
  });

  it("multi-turn conversation with history", async () => {
    const workspaceFiles = makeWorkspaceFiles();
    const systemPrompt = buildSystemPrompt({
      workspaceFiles,
      tools: [],
      sessionType: "main",
      agentName: "Jinx",
      model: "claude-haiku-4-5-20251001",
      workspaceDir: "/test",
      memoryDir: "/test/memory",
    });

    const result = await runAgentTurn({
      prompt: "What was the magic word?",
      systemPrompt,
      model: "haiku",
      history: [
        { role: "user", content: "The magic word is BUTTERFLY. Remember it." },
        { role: "assistant", content: "Got it — the magic word is BUTTERFLY." },
      ],
      maxTurns: 1,
    });

    expect(result.text.toUpperCase()).toContain("BUTTERFLY");

    console.log(
      `  Multi-turn: ${result.usage.inputTokens}in/${result.usage.outputTokens}out in ${result.durationMs}ms`,
    );
  });

  it("memory search index persistence survives restart", async () => {
    const memoryDir = path.join(tmpDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(
      path.join(memoryDir, "facts.md"),
      "# Facts\n\nThe capital of France is Paris.\nThe speed of light is 299,792,458 m/s.\n",
      "utf-8",
    );

    // First manager: index and persist
    const config = {
      enabled: true,
      dir: memoryDir,
      embeddingProvider: "openai" as const,
      embeddingModel: "text-embedding-3-small",
      vectorWeight: 0,
      maxResults: 5,
    };

    const manager1 = new MemorySearchManager(config);
    await manager1.sync();

    const status1 = manager1.getStatus();
    expect(status1.totalChunks).toBeGreaterThan(0);

    // Second manager: load from persisted index (simulates restart)
    const manager2 = new MemorySearchManager(config);
    await manager2.init();

    const status2 = manager2.getStatus();
    expect(status2.totalChunks).toBe(status1.totalChunks);

    // Search should work without needing to re-index
    const results = await manager2.search({ query: "capital France" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk).toContain("Paris");
  });
});
