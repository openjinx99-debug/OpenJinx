import { describe, expect, it, vi } from "vitest";
import type { ContainerManager } from "../../sandbox/container-manager.js";
import type { SandboxConfig } from "../../sandbox/types.js";
import { getExecToolDefinitions } from "./exec-tools.js";

const sandboxConfig: SandboxConfig = {
  enabled: true,
  timeoutMs: 300_000,
  idleTimeoutMs: 900_000,
  maxOutputBytes: 102_400,
  image: "node:22-slim",
  blockedPatterns: [],
  allowedMounts: [],
  workspaceWritable: true,
};

function createMockManager(
  execResult = {
    exitCode: 0,
    stdout: "hello world\n",
    stderr: "",
    timedOut: false,
    durationMs: 150,
  },
): ContainerManager {
  return {
    getOrCreate: vi.fn().mockResolvedValue({
      containerId: "jinx-test-abc",
      sessionKey: "test-session",
      status: "ready",
      startedAt: Date.now(),
      lastExecAt: Date.now(),
    }),
    exec: vi.fn().mockResolvedValue(execResult),
    stop: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn().mockResolvedValue(undefined),
    sweepIdle: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

function findTool(manager?: ContainerManager) {
  const mgr = manager ?? createMockManager();
  const tools = getExecToolDefinitions({
    workspaceDir: "/tmp/test-workspace",
    sandboxConfig,
    sessionKey: "test-session",
    containerManager: mgr,
  });
  const tool = tools.find((t) => t.name === "exec");
  if (!tool) {
    throw new Error("exec tool not found");
  }
  return { tool, manager: mgr };
}

describe("exec-tools", () => {
  it("returns exec tool definition", () => {
    const tools = getExecToolDefinitions({
      workspaceDir: "/tmp/test-workspace",
      sandboxConfig,
      sessionKey: "test-session",
      containerManager: createMockManager(),
    });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("exec");
  });

  it("rejects empty command", async () => {
    const { tool } = findTool();
    const result = (await tool.execute({ command: "" })) as Record<string, unknown>;
    expect(result.error).toContain("empty");
  });

  it("rejects whitespace-only command", async () => {
    const { tool } = findTool();
    const result = (await tool.execute({ command: "   " })) as Record<string, unknown>;
    expect(result.error).toContain("empty");
  });

  it("calls getOrCreate then exec on the container manager", async () => {
    const mgr = createMockManager();
    const { tool } = findTool(mgr);
    const result = (await tool.execute({ command: "echo hello" })) as Record<string, unknown>;

    expect(mgr.getOrCreate).toHaveBeenCalledWith("test-session", "/tmp/test-workspace");
    expect(mgr.exec).toHaveBeenCalledWith("test-session", "echo hello", {
      timeoutMs: undefined,
      workingDir: undefined,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world\n");
    expect(result.timedOut).toBe(false);
  });

  it("passes working_dir and timeout_ms through", async () => {
    const mgr = createMockManager();
    const { tool } = findTool(mgr);
    await tool.execute({ command: "ls", working_dir: "/workspace/src", timeout_ms: 5000 });

    expect(mgr.exec).toHaveBeenCalledWith("test-session", "ls", {
      timeoutMs: 5000,
      workingDir: "/workspace/src",
    });
  });

  it("description mentions persistent state", () => {
    const tools = getExecToolDefinitions({
      workspaceDir: "/tmp/test-workspace",
      sandboxConfig,
      sessionKey: "test-session",
      containerManager: createMockManager(),
    });
    expect(tools[0].description).toContain("persist");
  });
});
