/**
 * Integration: Marathon tool assembly — verifies that marathon sessions
 * get the FULL tool suite via assembleDefaultTools (core, exec, memory, cron,
 * channel, composio, marathon-tools, web, spawn), AND verifies that the
 * scoped chunk tool set (used by marathon.ts) only includes exec, marathon,
 * and web tools — excluding host file tools that cause path confusion.
 *
 * No LLM calls. Calls assembleDefaultTools and tool factory functions directly
 * with real-ish deps to prove the tool wiring is correct.
 */
import { describe, expect, it, vi } from "vitest";
import type { ContainerManager } from "../sandbox/container-manager.js";
import type { SessionEntry, SessionStore } from "../types/sessions.js";
import { createTestConfig } from "../__test__/config.js";
import { createMockChannel } from "../__test__/mock-channel.js";
import { assembleDefaultTools } from "../agents/runner.js";
import { getCoreToolDefinitions } from "../agents/tools/core-tools.js";
import { getExecToolDefinitions } from "../agents/tools/exec-tools.js";
import { getMarathonToolDefinitions } from "../agents/tools/marathon-tools.js";
import { getWebFetchToolDefinitions } from "../agents/tools/web-fetch-tools.js";
import { getWebSearchToolDefinitions } from "../agents/tools/web-search-tools.js";

/** Minimal container manager stub for tool assembly (no real containers needed). */
function createStubContainerManager(): ContainerManager {
  return {
    getOrCreate: vi.fn().mockResolvedValue({ containerId: "stub", status: "ready" }),
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    stop: vi.fn().mockResolvedValue(undefined),
    promote: vi.fn(),
    demote: vi.fn(),
    inspect: vi.fn().mockResolvedValue({ alive: true, uptimeMs: 1000, lifecycle: "persistent" }),
    reattach: vi.fn().mockResolvedValue(true),
    cleanupOrphans: vi.fn().mockResolvedValue(undefined),
    sweepIdle: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as ContainerManager;
}

function createStubSessions(): SessionStore {
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

/** Minimal cron service stub. */
function createStubCronService() {
  return {
    add: vi.fn(),
    remove: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    start: vi.fn(),
    stop: vi.fn(),
    get: vi.fn(),
  };
}

describe("marathon tool assembly integration", () => {
  it("marathon session gets full tool suite: core, exec, memory, cron, channel, marathon, web, spawn", () => {
    const config = createTestConfig({
      marathon: { enabled: true },
      composio: { enabled: true, apiKey: "test-key", userId: "test-user" },
    });

    const sessions = createStubSessions();
    const channels = new Map([["telegram", createMockChannel("telegram")]]);
    const containerManager = createStubContainerManager();
    const cronService = createStubCronService();
    const sessionKey = "marathon:abc12345";

    const tools = assembleDefaultTools(
      "/tmp/workspace",
      "/tmp/memory",
      undefined, // searchManager — even without it, memory tools should still be present (in list mode)
      config,
      cronService,
      sessionKey,
      sessions,
      channels,
      containerManager,
      "telegram",
      "main",
    );

    const toolNames = tools.map((t) => t.name);

    // Core tools — file operations
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("write");
    expect(toolNames).toContain("edit");
    expect(toolNames).toContain("glob");
    expect(toolNames).toContain("grep");

    // Exec tool — run commands in persistent container
    expect(toolNames).toContain("exec");

    // Cron tool — schedule jobs
    expect(toolNames).toContain("cron");

    // Channel tools — send messages, manage sessions
    expect(toolNames).toContain("message");
    expect(toolNames).toContain("sessions_send");
    expect(toolNames).toContain("sessions_list");

    // Web tools — search and fetch
    expect(toolNames).toContain("web_search");
    expect(toolNames).toContain("web_fetch");

    // Marathon-specific tools (detected by session key prefix "marathon:")
    expect(toolNames).toContain("marathon_status");
    expect(toolNames).toContain("marathon_plan_update");

    // Spawn tool — create subagents
    expect(toolNames).toContain("sessions_spawn");

    // Composio tools — external integrations (GitHub, Slack, etc.)
    expect(toolNames).toContain("composio_execute");
    expect(toolNames).toContain("composio_search");
    expect(toolNames).toContain("composio_connections");

    // Memory tools
    expect(toolNames).toContain("memory_search");
    expect(toolNames).toContain("memory_get");

    // Session tools
    expect(toolNames).toContain("session_status");

    // Verify total count — 26 tools for a fully-wired marathon session
    expect(toolNames).toHaveLength(26);
  });

  it("non-marathon session does NOT get marathon-specific tools", () => {
    const config = createTestConfig();
    const sessions = createStubSessions();
    const sessionKey = "telegram:dm:user1";

    const tools = assembleDefaultTools(
      "/tmp/workspace",
      "/tmp/memory",
      undefined,
      config,
      undefined,
      sessionKey,
      sessions,
      undefined,
      undefined,
      "telegram",
      "main",
    );

    const toolNames = tools.map((t) => t.name);

    // Should NOT have marathon tools
    expect(toolNames).not.toContain("marathon_status");
    expect(toolNames).not.toContain("marathon_plan_update");

    // Should still have core tools
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("write");
  });

  it("marathon session without containerManager does NOT get exec tool", () => {
    const config = createTestConfig();
    const sessions = createStubSessions();
    const sessionKey = "marathon:abc12345";

    const tools = assembleDefaultTools(
      "/tmp/workspace",
      "/tmp/memory",
      undefined,
      config,
      undefined,
      sessionKey,
      sessions,
      undefined,
      undefined, // No containerManager
      "telegram",
      "main",
    );

    const toolNames = tools.map((t) => t.name);

    // No exec without container manager
    expect(toolNames).not.toContain("exec");

    // Should still have marathon tools (they don't need containerManager)
    expect(toolNames).toContain("marathon_status");
    expect(toolNames).toContain("marathon_plan_update");
  });

  it("marathon chunk tools = [read, write, edit, glob, grep, exec, marathon_status, marathon_plan_update, web_search, web_fetch]", () => {
    const config = createTestConfig({
      marathon: { enabled: true },
    });
    const containerManager = createStubContainerManager();
    const sessionKey = "marathon:abc12345";
    const taskId = "marathon-abc12345";
    const workspaceDir = "/tmp/workspace";

    // Assemble chunk tools the same way marathon.ts does
    const chunkTools = [
      ...getCoreToolDefinitions({
        allowedDirs: [workspaceDir],
        sessionType: "main",
      }),
      ...getExecToolDefinitions({
        workspaceDir,
        sandboxConfig: config.sandbox,
        sessionKey,
        containerManager,
      }),
      ...getMarathonToolDefinitions({ taskId }),
      ...getWebSearchToolDefinitions({}),
      ...getWebFetchToolDefinitions({}),
    ];

    const toolNames = chunkTools.map((t) => t.name);

    // Exactly these 10 tools — native file tools + exec + marathon + web
    expect(toolNames).toEqual([
      "read",
      "write",
      "edit",
      "glob",
      "grep",
      "exec",
      "marathon_status",
      "marathon_plan_update",
      "web_search",
      "web_fetch",
    ]);

    // Verify no non-scoped tools
    expect(toolNames).not.toContain("memory_search");
    expect(toolNames).not.toContain("cron");
    expect(toolNames).not.toContain("message");
    expect(toolNames).not.toContain("sessions_spawn");
    expect(toolNames).not.toContain("composio_execute");
  });

  it("marathon session without cronService still lists cron tool but execute returns error", async () => {
    const config = createTestConfig();
    const sessions = createStubSessions();
    const sessionKey = "marathon:abc12345";

    const tools = assembleDefaultTools(
      "/tmp/workspace",
      "/tmp/memory",
      undefined,
      config,
      undefined, // No cronService
      sessionKey,
      sessions,
      undefined,
      undefined,
      "telegram",
      "main",
    );

    // Cron tool is always present (graceful degradation)
    const cronTool = tools.find((t) => t.name === "cron");
    expect(cronTool).toBeDefined();

    // But executing it without service returns an error
    const result = await cronTool!.execute({ action: "list" });
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    expect(parsed.success).toBe(false);
    expect(parsed.message).toContain("not available");
  });
});
