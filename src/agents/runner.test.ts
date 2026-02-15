import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MemorySearchManager } from "../memory/search-manager.js";
import type { MemorySearchResult } from "../types/memory.js";
import { createTestConfig } from "../__test__/config.js";
import { createTestSkillEntry } from "../__test__/skills.js";

// Mock all external dependencies
vi.mock("../providers/claude-provider.js", () => ({
  runAgentTurn: vi.fn().mockResolvedValue({
    text: "Hello!",
    messages: [],
    usage: { inputTokens: 10, outputTokens: 5 },
    durationMs: 100,
  }),
}));

vi.mock("../workspace/loader.js", () => ({
  loadWorkspaceFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock("../sessions/transcript.js", () => ({
  appendTranscriptTurn: vi.fn().mockResolvedValue(undefined),
  readTranscript: vi.fn().mockResolvedValue([]),
  resolveTranscriptPath: vi.fn().mockReturnValue("/tmp/transcript.jsonl"),
}));

vi.mock("../sessions/compaction.js", () => ({
  compactTranscript: vi
    .fn()
    .mockResolvedValue({ compacted: false, tokensBefore: 100, tokensAfter: 100 }),
  estimateTranscriptTokens: vi.fn().mockReturnValue(100),
  needsCompaction: vi.fn().mockReturnValue(false),
}));

vi.mock("../memory/flush.js", () => ({
  flushMemoryBeforeCompaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../skills/loader.js");
vi.mock("../skills/snapshot.js");
vi.mock("./system-prompt.js");

describe("runAgent – skills wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads skills from config dirs and passes snapshot to system prompt", async () => {
    const { loadSkillEntries } = await import("../skills/loader.js");
    const { buildSkillSnapshot } = await import("../skills/snapshot.js");
    const { buildSystemPromptBlocks } = await import("./system-prompt.js");
    const { runAgent } = await import("./runner.js");

    const weatherSkill = createTestSkillEntry({
      name: "weather",
      description: "Check the weather",
      eligible: true,
    });

    vi.mocked(loadSkillEntries).mockResolvedValue([weatherSkill]);
    vi.mocked(buildSkillSnapshot).mockReturnValue({
      prompt: "<available-skills>...</available-skills>",
      count: 1,
      names: ["weather"],
      version: "abc123",
    });
    vi.mocked(buildSystemPromptBlocks).mockReturnValue([
      { text: "system prompt with skills", cacheable: true },
    ]);

    const config = createTestConfig({
      skills: { dirs: ["~/.jinx/skills", "./jinx/skills"], exclude: [] },
    });

    await runAgent({
      prompt: "What's the weather?",
      sessionKey: "test-session",
      transcriptPath: "/tmp/transcript.jsonl",
      config,
      tools: [],
    });

    // Skills were loaded from the config dirs
    expect(loadSkillEntries).toHaveBeenCalledWith(config.skills.dirs);

    // Snapshot was built with loaded skills
    expect(buildSkillSnapshot).toHaveBeenCalledWith([weatherSkill]);

    // System prompt blocks received the skills snapshot
    expect(buildSystemPromptBlocks).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: {
          prompt: "<available-skills>...</available-skills>",
          count: 1,
          names: ["weather"],
          version: "abc123",
        },
      }),
    );
  });

  it("excludes skills listed in config.skills.exclude", async () => {
    const { loadSkillEntries } = await import("../skills/loader.js");
    const { buildSkillSnapshot } = await import("../skills/snapshot.js");
    const { buildSystemPromptBlocks } = await import("./system-prompt.js");
    const { runAgent } = await import("./runner.js");

    const weather = createTestSkillEntry({ name: "weather", eligible: true });
    const dangerous = createTestSkillEntry({ name: "dangerous", eligible: true });
    const notes = createTestSkillEntry({ name: "notes", eligible: true });

    vi.mocked(loadSkillEntries).mockResolvedValue([weather, dangerous, notes]);
    vi.mocked(buildSkillSnapshot).mockReturnValue({
      prompt: "",
      count: 0,
      names: [],
      version: "",
    });
    vi.mocked(buildSystemPromptBlocks).mockReturnValue([
      { text: "system prompt", cacheable: true },
    ]);

    const config = createTestConfig({
      skills: { dirs: ["./skills"], exclude: ["dangerous"] },
    });

    await runAgent({
      prompt: "hi",
      sessionKey: "test-session",
      transcriptPath: "/tmp/transcript.jsonl",
      config,
      tools: [],
    });

    // buildSkillSnapshot should receive only non-excluded skills
    expect(buildSkillSnapshot).toHaveBeenCalledWith([weather, notes]);
  });
});

// ── assembleDefaultTools – session tools wiring ─────────────────────────────

describe("assembleDefaultTools", () => {
  it("includes session_status tool when sessions and sessionKey are provided", async () => {
    const { assembleDefaultTools } = await import("./runner.js");

    const sessions = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      save: vi.fn(),
      load: vi.fn(),
    };

    const config = createTestConfig();
    const tools = assembleDefaultTools(
      "/tmp/workspace",
      "/tmp/memory",
      undefined, // searchManager
      config,
      undefined, // cronService
      "test-session-key",
      sessions,
    );

    const names = tools.map((t) => t.name);
    expect(names).toContain("session_status");
  });

  it("excludes session_status tool when sessions is not provided", async () => {
    const { assembleDefaultTools } = await import("./runner.js");

    const config = createTestConfig();
    const tools = assembleDefaultTools("/tmp/workspace", "/tmp/memory", undefined, config);

    const names = tools.map((t) => t.name);
    expect(names).not.toContain("session_status");
  });

  it("does not include channel tools when no deps are wired", async () => {
    const { assembleDefaultTools } = await import("./runner.js");

    const config = createTestConfig();
    const tools = assembleDefaultTools("/tmp/workspace", "/tmp/memory", undefined, config);

    const names = tools.map((t) => t.name);
    expect(names).not.toContain("message");
    expect(names).not.toContain("sessions_send");
    expect(names).not.toContain("sessions_list");
  });

  it("includes channel tools when both sessions and channels are provided", async () => {
    const { assembleDefaultTools } = await import("./runner.js");

    const sessions = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      save: vi.fn(),
      load: vi.fn(),
    };

    const channels = new Map();
    const config = createTestConfig();
    const tools = assembleDefaultTools(
      "/tmp/workspace",
      "/tmp/memory",
      undefined,
      config,
      undefined,
      "test-key",
      sessions,
      channels,
    );

    const names = tools.map((t) => t.name);
    expect(names).toContain("message");
    expect(names).toContain("sessions_send");
    expect(names).toContain("sessions_list");
  });

  it("includes cron tool that works when cronService is provided", async () => {
    const { assembleDefaultTools } = await import("./runner.js");

    const fakeCron = {
      list: vi.fn().mockReturnValue([]),
    };
    const config = createTestConfig();
    const tools = assembleDefaultTools(
      "/tmp/workspace",
      "/tmp/memory",
      undefined,
      config,
      fakeCron as never,
    );

    const cronTool = tools.find((t) => t.name === "cron");
    expect(cronTool).toBeDefined();

    // With a real service, list action should work
    const result = await cronTool!.execute({ action: "list" });
    expect(result).toHaveProperty("jobs");
  });

  it("includes cron tool that returns error when cronService is not provided", async () => {
    const { assembleDefaultTools } = await import("./runner.js");

    const config = createTestConfig();
    const tools = assembleDefaultTools("/tmp/workspace", "/tmp/memory", undefined, config);

    const cronTool = tools.find((t) => t.name === "cron");
    expect(cronTool).toBeDefined();

    // Without a service, cron tool should report unavailable
    const result = (await cronTool!.execute({ action: "list" })) as {
      success: boolean;
      message: string;
    };
    expect(result.success).toBe(false);
    expect(result.message).toContain("not available");
  });
});

// ── buildRagContext ─────────────────────────────────────────────────────────

describe("buildRagContext", () => {
  it("returns empty string when no results", async () => {
    const { buildRagContext } = await import("./runner.js");

    const mockManager = { search: vi.fn().mockResolvedValue([]) } as unknown as MemorySearchManager;
    const result = await buildRagContext(mockManager, "hello");

    expect(result).toBe("");
    expect(mockManager.search).toHaveBeenCalledWith({
      query: "hello",
      maxResults: 5,
      minScore: 0.3,
    });
  });

  it("formats results with file paths and scores", async () => {
    const { buildRagContext } = await import("./runner.js");

    const results: MemorySearchResult[] = [
      {
        filePath: "preferences.md",
        chunk: "User likes TypeScript",
        startLine: 5,
        endLine: 7,
        score: 0.85,
        vectorScore: 0.9,
        textScore: 0.8,
      },
      {
        filePath: "notes.md",
        chunk: "Favorite color is blue",
        startLine: 1,
        endLine: 2,
        score: 0.42,
        vectorScore: 0.5,
        textScore: 0.3,
      },
    ];
    const mockManager = {
      search: vi.fn().mockResolvedValue(results),
    } as unknown as MemorySearchManager;
    const result = await buildRagContext(mockManager, "what do you know about me?");

    expect(result).toContain("# Relevant Memory");
    expect(result).toContain("[preferences.md:5] (score: 0.85)");
    expect(result).toContain("User likes TypeScript");
    expect(result).toContain("[notes.md:1] (score: 0.42)");
    expect(result).toContain("Favorite color is blue");
  });

  it("returns empty string on search failure", async () => {
    const { buildRagContext } = await import("./runner.js");

    const mockManager = {
      search: vi.fn().mockRejectedValue(new Error("index corrupted")),
    } as unknown as MemorySearchManager;
    const result = await buildRagContext(mockManager, "test");

    expect(result).toBe("");
  });
});

// ── compaction wiring ───────────────────────────────────────────────────────

describe("runAgent – compaction wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls compactTranscript before loading history", async () => {
    const { compactTranscript } = await import("../sessions/compaction.js");
    const { loadSkillEntries } = await import("../skills/loader.js");
    const { buildSkillSnapshot } = await import("../skills/snapshot.js");
    const { buildSystemPromptBlocks } = await import("./system-prompt.js");
    const { runAgent } = await import("./runner.js");

    vi.mocked(loadSkillEntries).mockResolvedValue([]);
    vi.mocked(buildSkillSnapshot).mockReturnValue({ prompt: "", count: 0, names: [], version: "" });
    vi.mocked(buildSystemPromptBlocks).mockReturnValue([
      { text: "system prompt", cacheable: true },
    ]);
    vi.mocked(compactTranscript).mockResolvedValue({
      compacted: true,
      tokensBefore: 180_000,
      tokensAfter: 20_000,
    });

    const config = createTestConfig();

    await runAgent({
      prompt: "hello",
      sessionKey: "test-session",
      transcriptPath: "/tmp/transcript.jsonl",
      config,
      tools: [],
    });

    expect(compactTranscript).toHaveBeenCalledWith(
      "/tmp/transcript.jsonl",
      200_000, // context window for sonnet
      expect.any(Function),
    );
  });
});

// ── flush wiring ────────────────────────────────────────────────────────

describe("runAgent – pre-compaction flush wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls flushMemoryBeforeCompaction before compactTranscript when approaching limit", async () => {
    const { flushMemoryBeforeCompaction } = await import("../memory/flush.js");
    const { compactTranscript, needsCompaction } = await import("../sessions/compaction.js");
    const { loadSkillEntries } = await import("../skills/loader.js");
    const { buildSkillSnapshot } = await import("../skills/snapshot.js");
    const { buildSystemPromptBlocks } = await import("./system-prompt.js");
    const { runAgent } = await import("./runner.js");

    vi.mocked(loadSkillEntries).mockResolvedValue([]);
    vi.mocked(buildSkillSnapshot).mockReturnValue({ prompt: "", count: 0, names: [], version: "" });
    vi.mocked(buildSystemPromptBlocks).mockReturnValue([
      { text: "system prompt", cacheable: true },
    ]);

    // Simulate approaching context limit
    vi.mocked(needsCompaction).mockReturnValue(true);

    const callOrder: string[] = [];
    vi.mocked(flushMemoryBeforeCompaction).mockImplementation(async () => {
      callOrder.push("flush");
    });
    vi.mocked(compactTranscript).mockImplementation(async () => {
      callOrder.push("compact");
      return { compacted: true, tokensBefore: 180_000, tokensAfter: 20_000 };
    });

    const config = createTestConfig();

    await runAgent({
      prompt: "hello",
      sessionKey: "test-session",
      transcriptPath: "/tmp/transcript.jsonl",
      config,
      tools: [],
    });

    expect(flushMemoryBeforeCompaction).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "test-session",
        contextSummary: expect.stringContaining("200000"),
      }),
    );
    expect(callOrder).toEqual(["flush", "compact"]);
  });

  it("skips flush when transcript is well under context limit", async () => {
    const { flushMemoryBeforeCompaction } = await import("../memory/flush.js");
    const { needsCompaction } = await import("../sessions/compaction.js");
    const { loadSkillEntries } = await import("../skills/loader.js");
    const { buildSkillSnapshot } = await import("../skills/snapshot.js");
    const { buildSystemPromptBlocks } = await import("./system-prompt.js");
    const { runAgent } = await import("./runner.js");

    vi.mocked(loadSkillEntries).mockResolvedValue([]);
    vi.mocked(buildSkillSnapshot).mockReturnValue({ prompt: "", count: 0, names: [], version: "" });
    vi.mocked(buildSystemPromptBlocks).mockReturnValue([
      { text: "system prompt", cacheable: true },
    ]);

    // Not near context limit
    vi.mocked(needsCompaction).mockReturnValue(false);

    const config = createTestConfig();

    await runAgent({
      prompt: "hello",
      sessionKey: "test-session",
      transcriptPath: "/tmp/transcript.jsonl",
      config,
      tools: [],
    });

    expect(flushMemoryBeforeCompaction).not.toHaveBeenCalled();
  });
});
