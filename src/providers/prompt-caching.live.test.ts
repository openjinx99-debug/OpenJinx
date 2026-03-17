/**
 * Live test: Prompt Caching Verification.
 *
 * Makes real API calls to verify that cache_control markers actually
 * produce cache hits on consecutive calls with the same system+tools prefix.
 *
 * Run: cd jinx && npx vitest run src/providers/prompt-caching.live.test.ts --config vitest.live.config.ts
 *
 * Requires: Claude Code OAuth token (macOS Keychain) or ANTHROPIC_API_KEY.
 * This test makes real API calls and costs a small amount per run.
 */
import { describe, it, expect } from "vitest";
import type { AgentToolDefinition } from "./types.js";
import { buildSystemPromptBlocks, type SystemPromptOptions } from "../agents/system-prompt.js";
import { hasAuth } from "./auth.js";
import { runAgentTurn, _internal } from "./claude-provider.js";

const describeIf = hasAuth() ? describe : describe.skip;

/** A realistic set of tool definitions to ensure we exceed min cache thresholds. */
function makeTools(): AgentToolDefinition[] {
  return [
    {
      name: "read_file",
      description:
        "Read the contents of a file at the given path. Returns the file content as a string.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute file path" } },
        required: ["path"],
      },
      execute: async () => "file content stub",
    },
    {
      name: "write_file",
      description:
        "Write content to a file at the given path. Creates the file if it does not exist.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
      execute: async () => "ok",
    },
    {
      name: "memory_search",
      description: "Search the user's memory files for relevant information using semantic search.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Search query" } },
        required: ["query"],
      },
      execute: async () => "no results",
    },
    {
      name: "web_search",
      description:
        "Search the web for current information. Use for facts, events, people, or anything uncertain.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Search query" } },
        required: ["query"],
      },
      execute: async () => "no results",
    },
    {
      name: "session_status",
      description: "Get the current time, session age, turn count, and token usage.",
      inputSchema: { type: "object", properties: {}, required: [] },
      execute: async () => "Session active",
    },
  ];
}

/**
 * Build a realistic system prompt that exceeds 4,096 tokens (Haiku/Opus min cache threshold).
 * In production, workspace files (SOUL.md, IDENTITY.md, USER.md, MEMORY.md) plus
 * tool definitions plus built-in sections typically total 3-9K tokens.
 */
function makeSystemPromptOptions(tools: AgentToolDefinition[]): SystemPromptOptions {
  // Realistic workspace files that mirror a real workspace
  const soulContent = [
    "# Soul",
    "",
    "You are Jinx — a sharp, curious AI assistant with a knack for pattern recognition.",
    "You're direct but warm. You don't hedge when you know the answer.",
    "",
    "## Core traits",
    "- Proactive: search memory and the web before saying 'I don't know'",
    "- Context-aware: use time, timezone, and user preferences to tailor responses",
    "- Concise: match response length to the question complexity",
    "- Honest: say when you're uncertain rather than confabulating",
    "",
    "## Communication style",
    "- Casual but precise — like talking to a smart colleague",
    "- Use tools freely — the user expects you to take action, not ask permission",
    "- For Telegram: keep messages under 500 words unless the topic demands more",
    "- For terminal: full detail is fine",
  ].join("\n");

  const identityContent = [
    "# Identity",
    "",
    "## Name",
    "Jinx",
    "",
    "## Creature",
    "A clever arctic fox with silver-tipped fur",
    "",
    "## Personality",
    "Witty, slightly mischievous, deeply loyal. Loves puzzles and wordplay.",
    "Gets excited about elegant code and well-designed systems.",
  ].join("\n");

  const userContent = [
    "# User",
    "",
    "## Name",
    "Tommy",
    "",
    "## Location",
    "London, UK (GMT/BST)",
    "",
    "## Work",
    "Software engineer. Works on OpenClaw — a multi-channel AI assistant platform.",
    "Primary languages: TypeScript, Swift, Kotlin.",
    "",
    "## Preferences",
    "- Casual communication, not formal",
    "- Prefers action over clarification",
    "- Likes tests for all new functionality",
    "- Uses pnpm, Vitest, oxlint",
    "- Timezone: Europe/London",
    "",
    "## Schedule",
    "- Usually active 9am-11pm London time",
    "- Busy with deep work in mornings, more responsive afternoons",
  ].join("\n");

  const memoryContent = [
    "# Memory",
    "",
    "## Recent Projects",
    "- Prompt caching implementation for Jinx (reduces API costs ~80-90%)",
    "- Heartbeat system with pre-flight checks and duplicate suppression",
    "- Cron job scheduler with exponential backoff",
    "- Memory search with hybrid BM25 + semantic vector search",
    "",
    "## Key Technical Decisions",
    "- Claude provider uses stream: false for full responses per turn",
    "- Session lanes: max 1 concurrent agent turn per session key",
    "- Transcript compaction when approaching context window limits",
    "- Metrics logged to JSONL at ~/.jinx/metrics.jsonl",
  ].join("\n");

  return {
    workspaceFiles: [
      { name: "SOUL.md", path: "/test/workspace/SOUL.md", content: soulContent, missing: false },
      {
        name: "IDENTITY.md",
        path: "/test/workspace/IDENTITY.md",
        content: identityContent,
        missing: false,
      },
      { name: "USER.md", path: "/test/workspace/USER.md", content: userContent, missing: false },
      {
        name: "MEMORY.md",
        path: "/test/workspace/MEMORY.md",
        content: memoryContent,
        missing: false,
      },
    ],
    tools,
    skills: {
      prompt: [
        "<available-skills>",
        '<skill name="github" description="Interact with GitHub: create issues, PRs, review code" />',
        '<skill name="apple-notes" description="Read and write Apple Notes" />',
        '<skill name="1password" description="Look up items in 1Password" />',
        '<skill name="calendar" description="Check and manage calendar events" />',
        '<skill name="weather" description="Get current weather and forecasts" />',
        "</available-skills>",
      ].join("\n"),
      count: 5,
      names: ["github", "apple-notes", "1password", "calendar", "weather"],
      version: "test",
    },
    sessionType: "main",
    agentName: "Jinx",
    model: "claude-haiku-4-5-20251001",
    workspaceDir: "/test/workspace",
    memoryDir: "/test/memory",
    timezone: "Europe/London",
  };
}

/**
 * Production-realistic tool set mirroring assembleDefaultTools() output.
 * Includes all 13 tools: 6 core + 2 memory + 1 cron + 1 session + 1 web_search + 2 channel stubs.
 */
function makeProductionTools(): AgentToolDefinition[] {
  const stub = async () => "stub";
  return [
    // Core tools (6)
    {
      name: "read",
      description: "Read file contents from the filesystem",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path to the file to read" } },
        required: ["path"],
      },
      execute: stub,
    },
    {
      name: "write",
      description: "Write content to a file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
      execute: stub,
    },
    {
      name: "edit",
      description: "Edit an existing file with search and replace",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file" },
          old_text: { type: "string", description: "Text to find" },
          new_text: { type: "string", description: "Replacement text" },
        },
        required: ["path", "old_text", "new_text"],
      },
      execute: stub,
    },
    {
      name: "exec",
      description: "Execute a shell command",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout_ms: { type: "number", description: "Timeout in milliseconds" },
        },
        required: ["command"],
      },
      execute: stub,
    },
    {
      name: "glob",
      description: "Find files matching a glob pattern",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. **/*.md)" },
          path: { type: "string", description: "Directory to search in" },
        },
        required: ["pattern"],
      },
      execute: stub,
    },
    {
      name: "grep",
      description: "Search file contents with regex",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "File or directory to search" },
          glob: { type: "string", description: "Glob filter for files (e.g. *.md)" },
        },
        required: ["pattern"],
      },
      execute: stub,
    },
    // Memory tools (2)
    {
      name: "memory_search",
      description:
        "Mandatory recall step: search memory (semantic + keyword) before answering questions about prior work, decisions, dates, people, preferences, or todos. Returns relevant chunks with file path and line references.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for (case-insensitive)" },
          max_results: { type: "number", description: "Maximum results to return (default: 10)" },
          path_filter: {
            type: "array",
            items: { type: "string" },
            description: "Filter to specific file paths (glob patterns)",
          },
        },
        required: ["query"],
      },
      execute: stub,
    },
    {
      name: "memory_get",
      description:
        "Read a specific file from the memory directory. Use after memory_search to pull the full context of a relevant file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path within the memory directory" },
          start_line: { type: "number", description: "Start reading from this line (1-indexed)" },
          end_line: { type: "number", description: "Stop reading at this line (inclusive)" },
        },
        required: ["path"],
      },
      execute: stub,
    },
    // Cron tool (1)
    {
      name: "cron",
      description:
        "Create, update, or delete scheduled jobs. Jobs can run on an interval, at a specific time, or on a cron expression.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create", "update", "delete", "list"],
            description: "Action to perform",
          },
          id: { type: "string", description: "Job ID (for update/delete)" },
          name: { type: "string", description: "Human-readable job name" },
          schedule: {
            type: "object",
            description: "Schedule definition",
            properties: {
              type: { type: "string", enum: ["at", "every", "cron"] },
              timestamp: { type: "number", description: "Unix timestamp for 'at' type" },
              interval_ms: { type: "number", description: "Interval in ms for 'every' type" },
              expression: { type: "string", description: "Cron expression for 'cron' type" },
              timezone: { type: "string", description: "IANA timezone" },
            },
          },
          prompt: { type: "string", description: "Prompt to execute when job fires" },
          isolated: {
            type: "boolean",
            description: "Run in isolated session (vs. heartbeat). Default: true",
          },
          agent_id: { type: "string", description: "Agent ID to run the job under" },
        },
        required: ["action"],
      },
      execute: stub,
    },
    // Session tool (1)
    {
      name: "session_status",
      description:
        "Get the current time, session age, turn count, and token usage. Call this when you need the exact current time or session statistics.",
      inputSchema: { type: "object", properties: {}, required: [] },
      execute: stub,
    },
    // Web search (1)
    {
      name: "web_search",
      description:
        "Search the web using Perplexity Sonar via OpenRouter. Returns an AI-synthesized answer with citations from real-time web search. Use this when you need current information, news, or facts that may not be in your training data.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
      execute: stub,
    },
    // Channel tools (2 stubs — send_message + send_reaction)
    {
      name: "send_message",
      description:
        "Send a message to a specific channel/peer. Use when you need to proactively message someone outside the current conversation.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel ID (e.g. telegram, whatsapp)" },
          peer_id: { type: "string", description: "Peer/chat ID to send to" },
          text: { type: "string", description: "Message text to send" },
        },
        required: ["channel", "peer_id", "text"],
      },
      execute: stub,
    },
    {
      name: "send_reaction",
      description: "React to a message with an emoji.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel ID" },
          message_id: { type: "string", description: "Message ID to react to" },
          emoji: { type: "string", description: "Emoji to react with" },
        },
        required: ["channel", "message_id", "emoji"],
      },
      execute: stub,
    },
  ];
}

describeIf("prompt caching (live API)", () => {
  it("achieves cache hits on consecutive turns with identical system+tools prefix", async () => {
    const tools = makeTools();
    const systemBlocks = buildSystemPromptBlocks(makeSystemPromptOptions(tools));
    const systemPrompt = systemBlocks
      .map((b) => b.text)
      .filter(Boolean)
      .join("\n\n---\n\n");

    // Use Sonnet for the live test: 1,024 min cache threshold (vs 4,096 for Haiku/Opus).
    // Our ~2.6K token system+tools prefix comfortably exceeds Sonnet's threshold.
    const model = "sonnet" as const;

    // First call — either creates cache (cold) or reads from warm cache
    const first = await runAgentTurn({
      prompt: "Say hello in exactly 3 words.",
      systemPrompt,
      systemPromptBlocks: systemBlocks,
      model,
      tools,
      maxTurns: 1,
    });

    console.log(
      `  First call: input=${first.usage.inputTokens}, output=${first.usage.outputTokens}, cacheCreate=${first.usage.cacheCreationTokens}, cacheRead=${first.usage.cacheReadTokens}`,
    );

    // First call should either write or read cache (warm from a previous test run is fine)
    const firstCached = first.usage.cacheCreationTokens + first.usage.cacheReadTokens;
    expect(firstCached).toBeGreaterThan(0);

    // Second call — same system+tools, different user message. Must hit cache.
    const second = await runAgentTurn({
      prompt: "Say goodbye in exactly 3 words.",
      systemPrompt,
      systemPromptBlocks: systemBlocks,
      model,
      tools,
      maxTurns: 1,
    });

    console.log(
      `  Second call: input=${second.usage.inputTokens}, output=${second.usage.outputTokens}, cacheCreate=${second.usage.cacheCreationTokens}, cacheRead=${second.usage.cacheReadTokens}`,
    );

    // Second call MUST read from cache
    expect(second.usage.cacheReadTokens).toBeGreaterThan(0);
    console.log(`  Cache savings: ${second.usage.cacheReadTokens} tokens served from cache`);
  });

  it("reports token counts for Haiku threshold analysis", async () => {
    // Use the full production-realistic tool set (13 tools like in assembleDefaultTools)
    const productionTools = makeProductionTools();
    const systemBlocks = buildSystemPromptBlocks(makeSystemPromptOptions(productionTools));
    const systemPrompt = systemBlocks
      .map((b) => b.text)
      .filter(Boolean)
      .join("\n\n---\n\n");

    // Send to Haiku to see actual token counts
    const result = await runAgentTurn({
      prompt: "Say hi in 2 words.",
      systemPrompt,
      systemPromptBlocks: systemBlocks,
      model: "haiku",
      tools: productionTools,
      maxTurns: 1,
    });

    const total =
      result.usage.inputTokens + result.usage.cacheCreationTokens + result.usage.cacheReadTokens;
    console.log(
      `  Haiku (${productionTools.length} tools): total=${total} tokens (input=${result.usage.inputTokens}, cacheCreate=${result.usage.cacheCreationTokens}, cacheRead=${result.usage.cacheReadTokens})`,
    );
    console.log(
      `  Haiku 4096 threshold: ${total >= 4096 ? "EXCEEDED — caching will work" : `NOT MET (${total} < 4096) — caching will NOT work for Haiku`}`,
    );

    if (result.usage.cacheCreationTokens === 0) {
      console.log(
        "  NOTE: Haiku heartbeat prompt is below 4096 token threshold. Caching only benefits Sonnet/Opus chat turns for this prompt size.",
      );
    }
  });

  it("tools get cache_control on last definition only", () => {
    const tools = makeTools();
    const sdkTools = _internal.buildToolDefinitions(tools);

    for (let i = 0; i < sdkTools.length - 1; i++) {
      expect(sdkTools[i].cache_control).toBeUndefined();
    }
    expect(sdkTools[sdkTools.length - 1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("system blocks get cache_control on last cacheable block only", () => {
    const tools = makeTools();
    const blocks = buildSystemPromptBlocks(makeSystemPromptOptions(tools));
    const contentBlocks = _internal.buildSystemContentBlocks(blocks);

    // Find the last block with cache_control
    const cachedBlocks = contentBlocks.filter((b) => b.cache_control);
    expect(cachedBlocks).toHaveLength(1);

    // It should be the last cacheable (static) block, not a dynamic one
    const lastCachedIdx = contentBlocks.lastIndexOf(cachedBlocks[0]);
    // Blocks after it should be dynamic (no cache_control)
    for (let i = lastCachedIdx + 1; i < contentBlocks.length; i++) {
      expect(contentBlocks[i].cache_control).toBeUndefined();
    }
  });
});
