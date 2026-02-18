/**
 * Integration: Marathon container lifecycle — persistent containers,
 * orphan exclusions, reattach, resource limits.
 *
 * Uses the real container manager with mocked child_process.spawn,
 * testing lifecycle transitions, sweep behavior, and reattach logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxConfig } from "../sandbox/types.js";

// Mock child_process.spawn before importing container-manager
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("../sandbox/runtime-detect.js", () => ({
  isAppleContainerReady: () => true,
  describeRuntime: (available: boolean) =>
    available ? "Using Apple Container" : "Apple Container not found",
}));

vi.mock("../sandbox/mount-security.js", () => ({
  buildMountList: (_dir: string, _config: SandboxConfig) => [
    { hostPath: "/test/workspace", containerPath: "/workspace", readOnly: false },
  ],
}));

vi.mock("../infra/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { createContainerManager } = await import("../sandbox/container-manager.js");

const defaultConfig: SandboxConfig = {
  enabled: true,
  timeoutMs: 300_000,
  idleTimeoutMs: 1000, // Short for testing
  maxOutputBytes: 102_400,
  image: "node:22-slim",
  blockedPatterns: [],
  allowedMounts: [],
  workspaceWritable: true,
};

/** Helper: create a mock child process. */
function createMockChild(exitCode = 0, stdout = "", stderr = "") {
  const stdoutListeners: ((chunk: Buffer) => void)[] = [];
  const stderrListeners: ((chunk: Buffer) => void)[] = [];
  const closeListeners: ((code: number | null) => void)[] = [];
  const errorListeners: ((err: Error) => void)[] = [];

  const child = {
    stdout: {
      on(event: string, cb: (chunk: Buffer) => void) {
        if (event === "data") {
          stdoutListeners.push(cb);
        }
      },
    },
    stderr: {
      on(event: string, cb: (chunk: Buffer) => void) {
        if (event === "data") {
          stderrListeners.push(cb);
        }
      },
    },
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === "close") {
        closeListeners.push(cb as (code: number | null) => void);
      }
      if (event === "error") {
        errorListeners.push(cb as (err: Error) => void);
      }
    },
    kill: vi.fn(),
    _autoClose() {
      queueMicrotask(() => {
        if (stdout) {
          for (const cb of stdoutListeners) {
            cb(Buffer.from(stdout));
          }
        }
        if (stderr) {
          for (const cb of stderrListeners) {
            cb(Buffer.from(stderr));
          }
        }
        queueMicrotask(() => {
          for (const cb of closeListeners) {
            cb(exitCode);
          }
        });
      });
    },
  };
  return child;
}

describe("marathon container lifecycle integration", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSpawn.mockReset();
    mockSpawn.mockImplementation(() => {
      const child = createMockChild(0);
      child._autoClose();
      return child;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persistent container survives beyond idle timeout", async () => {
    let stopCalled = false;

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      if (args[0] === "stop") {
        stopCalled = true;
      }
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    await mgr.getOrCreate("marathon:test", "/test/workspace");

    // Promote to persistent
    mgr.promote("marathon:test");

    // Advance well past idle timeout
    vi.advanceTimersByTime(5000);
    mgr.sweepIdle();
    await vi.advanceTimersByTimeAsync(100);

    expect(stopCalled).toBe(false);

    await mgr.dispose();
  });

  it("cleanupOrphans skips marathon containers from active checkpoints", async () => {
    const removedIds: string[] = [];
    let lsCallCount = 0;

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      if (args[0] === "ls") {
        lsCallCount++;
        const stdout = lsCallCount === 1 ? "" : "jinx-marathon-keep\njinx-ephemeral-remove\n";
        const child = createMockChild(0, stdout);
        child._autoClose();
        return child;
      }
      if (args[0] === "rm") {
        removedIds.push(args[2]);
      }
      const child = createMockChild(0);
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    await vi.advanceTimersByTimeAsync(10);

    // Cleanup with marathon container excluded
    await mgr.cleanupOrphans(["jinx-marathon-keep"]);

    expect(removedIds).toContain("jinx-ephemeral-remove");
    expect(removedIds).not.toContain("jinx-marathon-keep");

    await mgr.dispose();
  });

  it("reattach works for alive container", async () => {
    mockSpawn.mockImplementation((_bin: string, _args: string[]) => {
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    const alive = await mgr.reattach("jinx-marathon-existing", "marathon:test", "/test/workspace");
    expect(alive).toBe(true);

    const inspected = await mgr.inspect("marathon:test");
    expect(inspected).toBeDefined();
    expect(inspected!.alive).toBe(true);
    expect(inspected!.lifecycle).toBe("persistent");

    await mgr.dispose();
  });

  it("reattach returns false for dead container, caller recreates", async () => {
    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      if (args[0] === "exec" && args.includes("true")) {
        // Liveness check fails
        const child = createMockChild(1);
        child._autoClose();
        return child;
      }
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    const alive = await mgr.reattach("jinx-marathon-dead", "marathon:test", "/test/workspace");
    expect(alive).toBe(false);

    // Caller would recreate:
    const session = await mgr.getOrCreate("marathon:test", "/test/workspace");
    expect(session.status).toBe("ready");

    await mgr.dispose();
  });

  it("resource limits (cpus/memory) passed to container runtime", async () => {
    const resourceConfig: SandboxConfig = {
      ...defaultConfig,
      cpus: 4,
      memoryGB: 8,
    };

    const spawnCalls: { args: string[] }[] = [];

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      spawnCalls.push({ args });
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(resourceConfig);
    await mgr.getOrCreate("marathon:resource-test", "/test/workspace");

    const runCall = spawnCalls.find((c) => c.args[0] === "run");
    expect(runCall).toBeDefined();
    expect(runCall!.args).toContain("--cpus");
    expect(runCall!.args).toContain("4");
    expect(runCall!.args).toContain("--memory");
    expect(runCall!.args).toContain("8g");

    await mgr.dispose();
  });

  it("workspace files persist after container restart (host mount pattern)", async () => {
    mockSpawn.mockImplementation((_bin: string, _args: string[]) => {
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);

    // Create container
    const session1 = await mgr.getOrCreate("marathon:persist-test", "/test/workspace");
    expect(session1.status).toBe("ready");

    // Stop container
    await mgr.stop("marathon:persist-test");

    // Create new container with same workspace dir — workspace survives
    const session2 = await mgr.getOrCreate("marathon:persist-test", "/test/workspace");
    expect(session2.status).toBe("ready");
    // Different container ID (new container), same workspace
    expect(session2.containerId).not.toBe(session1.containerId);

    await mgr.dispose();
  });
});
