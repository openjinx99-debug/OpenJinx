import { afterEach, describe, expect, it, vi } from "vitest";
import type { JinxConfig } from "../../types/config.js";
import type { SessionEntry, SessionStore } from "../../types/sessions.js";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { clearSubagentRegistry, listSubagentsForParent } from "../subagent-registry.js";
import { getSpawnToolDefinitions } from "./spawn-tools.js";

// Mock runAgent to avoid actual LLM calls
vi.mock("../runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({
    text: "Subagent completed the task successfully.",
    model: "sonnet",
    usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
    durationMs: 1000,
    messages: [],
  }),
}));

function createMockSessionStore(): SessionStore {
  const entries = new Map<string, SessionEntry>();
  return {
    get: (key) => entries.get(key),
    set: (key, entry) => entries.set(key, entry),
    delete: (key) => entries.delete(key),
    list: () => [...entries.values()],
    save: async () => {},
    load: async () => {},
  };
}

function findTool(ctx: Parameters<typeof getSpawnToolDefinitions>[0]) {
  const tools = getSpawnToolDefinitions(ctx);
  const tool = tools.find((t) => t.name === "sessions_spawn");
  if (!tool) {
    throw new Error("sessions_spawn tool not found");
  }
  return tool;
}

describe("spawn-tools", () => {
  const config = structuredClone(DEFAULT_CONFIG) as JinxConfig;

  afterEach(() => {
    clearSubagentRegistry();
  });

  it("returns sessions_spawn tool definition", () => {
    const sessions = createMockSessionStore();
    const tools = getSpawnToolDefinitions({
      parentSessionKey: "test:parent",
      config,
      sessions,
    });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("sessions_spawn");
  });

  it("rejects empty task", async () => {
    const sessions = createMockSessionStore();
    const tool = findTool({ parentSessionKey: "test:parent", config, sessions });
    const result = (await tool.execute({ task: "" })) as Record<string, unknown>;
    expect(result.error).toContain("empty");
  });

  it("spawns subagent and returns result", async () => {
    const sessions = createMockSessionStore();
    const tool = findTool({ parentSessionKey: "test:parent", config, sessions });

    const result = (await tool.execute({ task: "Research TypeScript 5.8 features" })) as Record<
      string,
      unknown
    >;

    expect(result.status).toBe("completed");
    expect(result.result).toBe("Subagent completed the task successfully.");
    expect(result.subagentSessionKey).toMatch(/^subagent:/);
    expect(result.usage).toBeDefined();
  });

  it("creates subagent session in session store", async () => {
    const sessions = createMockSessionStore();
    const tool = findTool({
      parentSessionKey: "test:parent",
      config,
      sessions,
      // Override cleanup to keep sessions
    });

    await tool.execute({ task: "Do something", cleanup: "keep" });

    // With cleanup="keep", the session should still exist
    const allSessions = sessions.list();
    const subagentSessions = allSessions.filter((s) => s.sessionKey.startsWith("subagent:"));
    expect(subagentSessions).toHaveLength(1);
    expect(subagentSessions[0].parentSessionKey).toBe("test:parent");
  });

  it("cleans up session on delete cleanup mode", async () => {
    const sessions = createMockSessionStore();
    const tool = findTool({ parentSessionKey: "test:parent", config, sessions });

    await tool.execute({ task: "Quick task", cleanup: "delete" });

    // With cleanup="delete" (default), session should be removed
    const allSessions = sessions.list();
    const subagentSessions = allSessions.filter((s) => s.sessionKey.startsWith("subagent:"));
    expect(subagentSessions).toHaveLength(0);
  });

  it("handles subagent failure gracefully", async () => {
    const { runAgent } = await import("../runner.js");
    vi.mocked(runAgent).mockRejectedValueOnce(new Error("Model quota exceeded"));

    const sessions = createMockSessionStore();
    const tool = findTool({ parentSessionKey: "test:parent", config, sessions });

    const result = (await tool.execute({ task: "This will fail" })) as Record<string, unknown>;

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Model quota exceeded");
  });

  it("tracks subagents in registry with keep mode", async () => {
    const sessions = createMockSessionStore();
    const tool = findTool({ parentSessionKey: "test:parent", config, sessions });

    await tool.execute({ task: "Task 1", cleanup: "keep" });
    await tool.execute({ task: "Task 2", cleanup: "keep" });

    const subagents = listSubagentsForParent("test:parent");
    expect(subagents).toHaveLength(2);
    expect(subagents.every((s) => s.status === "completed")).toBe(true);
  });
});
