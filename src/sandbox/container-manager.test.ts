import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxConfig } from "./types.js";

// Mock child_process.spawn before importing container-manager
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock runtime-detect to always report Apple Container as ready
vi.mock("./runtime-detect.js", () => ({
  isAppleContainerReady: () => true,
  describeRuntime: (available: boolean) =>
    available ? "Using Apple Container" : "Apple Container not found",
}));

// Mock mount-security to return a simple mount list
vi.mock("./mount-security.js", () => ({
  buildMountList: (_dir: string, _config: SandboxConfig) => [
    { hostPath: "/test/workspace", containerPath: "/workspace", readOnly: false },
  ],
}));

// Mock logger
vi.mock("../infra/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// We need to import after mocks are set up
const { createContainerManager } = await import("./container-manager.js");

const defaultConfig: SandboxConfig = {
  enabled: true,
  timeoutMs: 300_000,
  idleTimeoutMs: 900_000,
  maxOutputBytes: 102_400,
  image: "node:22-slim",
  blockedPatterns: [],
  allowedMounts: [],
  workspaceWritable: true,
};

/** Helper: create a mock child process that behaves like spawn. */
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
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
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
    // Helpers for test control
    _emitStdout(data: string) {
      for (const cb of stdoutListeners) {
        cb(Buffer.from(data));
      }
    },
    _emitStderr(data: string) {
      for (const cb of stderrListeners) {
        cb(Buffer.from(data));
      }
    },
    _emitClose(code: number | null = exitCode) {
      for (const cb of closeListeners) {
        cb(code);
      }
    },
    _emitError(err: Error) {
      for (const cb of errorListeners) {
        cb(err);
      }
    },
    // Auto-close after a tick by default (defers so listeners can be registered first)
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

describe("container-manager", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSpawn.mockReset();
    // Default: return a mock child that auto-closes with exit 0.
    // This handles the orphan cleanup spawn that fires on createContainerManager.
    mockSpawn.mockImplementation(() => {
      const child = createMockChild(0);
      child._autoClose();
      return child;
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it("creates manager with config", () => {
    const mgr = createContainerManager(defaultConfig);
    expect(mgr).toBeDefined();
    expect(mgr.getOrCreate).toBeTypeOf("function");
    expect(mgr.exec).toBeTypeOf("function");
    expect(mgr.dispose).toBeTypeOf("function");
  });

  it("getOrCreate starts a container and waits for readiness", async () => {
    let spawnCallCount = 0;

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      spawnCallCount++;
      const isRun = args[0] === "run";
      const isExec = args[0] === "exec";

      if (isRun) {
        // `container run -d ...` — succeed immediately
        const child = createMockChild(0);
        child._autoClose();
        return child;
      }

      if (isExec) {
        // `container exec {id} echo ready` — readiness probe
        const child = createMockChild(0, "ready\n");
        child._autoClose();
        return child;
      }

      // Fallback
      const child = createMockChild(0);
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    const session = await mgr.getOrCreate("test-session", "/test/workspace");

    expect(session.status).toBe("ready");
    expect(session.sessionKey).toBe("test-session");
    expect(session.containerId).toMatch(/^jinx-test-session-/);
    // Should have called spawn at least twice: once for run, once for readiness probe
    expect(spawnCallCount).toBeGreaterThanOrEqual(2);

    await mgr.dispose();
  });

  it("exec calls container exec with correct args", async () => {
    const spawnCalls: { bin: string; args: string[] }[] = [];

    mockSpawn.mockImplementation((bin: string, args: string[]) => {
      spawnCalls.push({ bin, args });
      // Exec with `sh -c` should return "output\n", everything else returns "ready\n"
      const isShExec = args[0] === "exec" && args.includes("sh");
      const child = createMockChild(0, isShExec ? "output\n" : "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    await mgr.getOrCreate("test-session", "/test/workspace");

    const result = await mgr.exec("test-session", "echo hello");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("output\n");

    // Find the exec call (not the run or readiness probe)
    const execCall = spawnCalls.find((c) => c.args[0] === "exec" && c.args.includes("sh"));
    expect(execCall).toBeDefined();
    expect(execCall!.bin).toBe("container");
    expect(execCall!.args).toContain("sh");
    expect(execCall!.args).toContain("-c");

    await mgr.dispose();
  });

  it("multiple exec calls reuse same container", async () => {
    let runCount = 0;

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      if (args[0] === "run") {
        runCount++;
      }
      const child = createMockChild(0, "ok\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    await mgr.getOrCreate("test-session", "/test/workspace");

    await mgr.exec("test-session", "echo 1");
    await mgr.exec("test-session", "echo 2");
    await mgr.exec("test-session", "echo 3");

    // Only one `container run` should have been called
    expect(runCount).toBe(1);

    await mgr.dispose();
  });

  it("concurrent getOrCreate shares ready promise", async () => {
    let runCount = 0;

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      if (args[0] === "run") {
        runCount++;
      }
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);

    // Fire two getOrCreate calls concurrently
    const [s1, s2] = await Promise.all([
      mgr.getOrCreate("concurrent-session", "/test/workspace"),
      mgr.getOrCreate("concurrent-session", "/test/workspace"),
    ]);

    expect(s1.containerId).toBe(s2.containerId);
    expect(runCount).toBe(1);

    await mgr.dispose();
  });

  it("stop calls container stop + rm -f", async () => {
    const spawnCalls: string[][] = [];

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      spawnCalls.push(args);
      const child = createMockChild(0);
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    await mgr.getOrCreate("stop-test", "/test/workspace");

    await mgr.stop("stop-test");

    // Should have called `container stop` and `container rm -f`
    const stopCall = spawnCalls.find((a) => a[0] === "stop");
    const rmCall = spawnCalls.find((a) => a[0] === "rm" && a[1] === "-f");

    expect(stopCall).toBeDefined();
    expect(rmCall).toBeDefined();

    await mgr.dispose();
  });

  it("sweepIdle stops containers past idle timeout", async () => {
    const shortIdleConfig: SandboxConfig = {
      ...defaultConfig,
      idleTimeoutMs: 1000, // 1 second for testing
    };

    let stopCalled = false;

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      if (args[0] === "stop") {
        stopCalled = true;
      }
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(shortIdleConfig);
    await mgr.getOrCreate("idle-test", "/test/workspace");

    // Advance time past idle timeout
    vi.advanceTimersByTime(2000);

    mgr.sweepIdle();

    // Give the async stop a tick to run
    await vi.advanceTimersByTimeAsync(100);

    expect(stopCalled).toBe(true);

    await mgr.dispose();
  });

  it("exec returns error for unknown session", async () => {
    const mgr = createContainerManager(defaultConfig);
    const result = await mgr.exec("no-such-session", "echo hi");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No ready container");

    await mgr.dispose();
  });

  it("output truncation at maxOutputBytes", async () => {
    const smallConfig: SandboxConfig = {
      ...defaultConfig,
      maxOutputBytes: 20,
    };

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      const isShExec = args[0] === "exec" && args.includes("sh");
      const output = isShExec ? "a".repeat(50) : "ready\n";
      const child = createMockChild(0, output);
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(smallConfig);
    await mgr.getOrCreate("truncate-test", "/test/workspace");

    const result = await mgr.exec("truncate-test", "echo lots");

    // 20 bytes + truncation message
    expect(result.stdout).toContain("[... output truncated]");

    await mgr.dispose();
  });

  it("dispose clears interval and stops all containers", async () => {
    mockSpawn.mockImplementation(() => {
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    await mgr.getOrCreate("dispose-test", "/test/workspace");

    // dispose should not throw
    await mgr.dispose();
  });

  // --- Failure-path tests ---

  it("getOrCreate rejects when container run fails", async () => {
    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      if (args[0] === "run") {
        const child = createMockChild(1, "", "image not found");
        child._autoClose();
        return child;
      }
      const child = createMockChild(0);
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    await expect(mgr.getOrCreate("fail-start", "/test/workspace")).rejects.toThrow(
      "Container start failed",
    );

    await mgr.dispose();
  });

  it("getOrCreate rejects on readiness timeout", async () => {
    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      if (args[0] === "run") {
        const child = createMockChild(0);
        child._autoClose();
        return child;
      }
      if (args[0] === "exec") {
        // Readiness probe always fails
        const child = createMockChild(1);
        child._autoClose();
        return child;
      }
      // rm -f cleanup
      const child = createMockChild(0);
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    // Attach rejection handler immediately to prevent unhandled-rejection warning
    // during fake timer advancement (the readyPromise is stored as a property)
    const promise = mgr.getOrCreate("timeout-test", "/test/workspace").catch((e) => e);

    // Advance time past the 30s readiness timeout
    await vi.advanceTimersByTimeAsync(35_000);

    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("did not become ready");

    await mgr.dispose();
  });

  it("exec returns timedOut when command exceeds timeout", async () => {
    const shortTimeoutConfig: SandboxConfig = {
      ...defaultConfig,
      timeoutMs: 100,
    };

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      const isShExec = args[0] === "exec" && args.includes("sh");
      if (isShExec) {
        // Never auto-close — simulates a long-running command
        const child = createMockChild(0);
        // Don't call _autoClose — let the timeout fire.
        // When kill is called, emit close after a tick.
        child.kill = vi.fn().mockImplementation(() => {
          queueMicrotask(() => child._emitClose(137));
        });
        return child;
      }
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(shortTimeoutConfig);
    await mgr.getOrCreate("timeout-exec", "/test/workspace");

    const resultPromise = mgr.exec("timeout-exec", "sleep 999");
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    expect(result.timedOut).toBe(true);

    await mgr.dispose();
  });

  it("detects dead container and removes from map", async () => {
    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      const isShExec = args[0] === "exec" && args.includes("sh");
      const isLivenessProbe = args[0] === "exec" && args.includes("true");

      if (isShExec) {
        // Exec fails with non-zero
        const child = createMockChild(1, "", "container died");
        child._autoClose();
        return child;
      }
      if (isLivenessProbe) {
        // Liveness probe also fails — container is dead
        const child = createMockChild(1);
        child._autoClose();
        return child;
      }
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    await mgr.getOrCreate("dead-container", "/test/workspace");

    const result = await mgr.exec("dead-container", "echo hi");
    expect(result.exitCode).toBe(1);

    // Container should now be gone — next exec returns "No ready container"
    const result2 = await mgr.exec("dead-container", "echo hi");
    expect(result2.stderr).toContain("No ready container");

    await mgr.dispose();
  });

  it("double stop is idempotent", async () => {
    mockSpawn.mockImplementation(() => {
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    await mgr.getOrCreate("double-stop", "/test/workspace");

    await mgr.stop("double-stop");
    // Second stop should not throw
    await mgr.stop("double-stop");

    await mgr.dispose();
  });

  it("handles spawn ENOENT gracefully", async () => {
    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      if (args[0] === "run") {
        const child = createMockChild(1);
        // Emit error instead of close
        queueMicrotask(() => {
          child._emitError(new Error("spawn container ENOENT"));
        });
        return child;
      }
      const child = createMockChild(0);
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    await expect(mgr.getOrCreate("enoent-test", "/test/workspace")).rejects.toThrow(
      "Failed to spawn container process",
    );

    await mgr.dispose();
  });

  it("getOrCreate retries after failed start clears stale entry", async () => {
    let attempt = 0;

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      if (args[0] === "run") {
        attempt++;
        if (attempt === 1) {
          // First attempt fails
          const child = createMockChild(1, "", "transient error");
          child._autoClose();
          return child;
        }
        // Second attempt succeeds
        const child = createMockChild(0);
        child._autoClose();
        return child;
      }
      const child = createMockChild(0, "ready\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);

    // First attempt should fail
    await expect(mgr.getOrCreate("retry-test", "/test/workspace")).rejects.toThrow(
      "Container start failed",
    );

    // Second attempt should succeed (stale entry cleared)
    const session = await mgr.getOrCreate("retry-test", "/test/workspace");
    expect(session.status).toBe("ready");

    await mgr.dispose();
  });

  it("shellQuote is applied to workDir in exec args", async () => {
    const spawnCalls: { args: string[] }[] = [];

    mockSpawn.mockImplementation((_bin: string, args: string[]) => {
      spawnCalls.push({ args });
      const child = createMockChild(0, "ok\n");
      child._autoClose();
      return child;
    });

    const mgr = createContainerManager(defaultConfig);
    await mgr.getOrCreate("quote-test", "/test/workspace");

    await mgr.exec("quote-test", "ls", { workingDir: "/path with spaces/dir" });

    // Find the exec call with sh -c
    const execCall = spawnCalls.find((c) => c.args[0] === "exec" && c.args.includes("sh"));
    expect(execCall).toBeDefined();

    // The last arg should contain the single-quoted workDir
    const shCommand = execCall!.args[execCall!.args.length - 1];
    expect(shCommand).toContain("'/path with spaces/dir'");

    await mgr.dispose();
  });
});
