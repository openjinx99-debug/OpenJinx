import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../infra/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../agents/runner.js", () => ({
  runAgent: vi.fn(),
}));

vi.mock("../infra/timeout.js", () => ({
  withTimeout: vi.fn((promise: Promise<unknown>) => promise),
}));

vi.mock("../sessions/transcript.js", () => ({
  resolveTranscriptPath: vi.fn().mockReturnValue("/tmp/transcript.jsonl"),
}));

vi.mock("./marathon-prompts.js", () => ({
  buildTestFixPrompt: vi.fn().mockReturnValue("Fix the tests"),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    access: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── detectTestCommand ───────────────────────────────────────────────

describe("detectTestCommand", () => {
  it("detects Node.js test command from package.json", async () => {
    const { detectTestCommand } = await import("./marathon-test-loop.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readFile).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return JSON.stringify({
          scripts: { test: "vitest run" },
        }) as never;
      }
      throw new Error("ENOENT");
    });

    vi.mocked(fsMod.default.access).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return undefined as never;
      }
      throw new Error("ENOENT");
    });

    const result = await detectTestCommand("/workspace");

    expect(result).toBeDefined();
    expect(result!.command).toContain("test");
    expect(result!.command).toContain("npm");
  });

  it("detects pnpm when pnpm-lock.yaml exists", async () => {
    const { detectTestCommand } = await import("./marathon-test-loop.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readFile).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return JSON.stringify({
          scripts: { test: "vitest run" },
        }) as never;
      }
      throw new Error("ENOENT");
    });

    vi.mocked(fsMod.default.access).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json") || p.endsWith("pnpm-lock.yaml")) {
        return undefined as never;
      }
      throw new Error("ENOENT");
    });

    const result = await detectTestCommand("/workspace");

    expect(result).toBeDefined();
    expect(result!.command).toContain("pnpm test");
    expect(result!.packageManager).toBe("pnpm");
  });

  it("skips default npm init test stub", async () => {
    const { detectTestCommand } = await import("./marathon-test-loop.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readFile).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return JSON.stringify({
          scripts: { test: 'echo "Error: no test specified" && exit 1' },
        }) as never;
      }
      throw new Error("ENOENT");
    });

    vi.mocked(fsMod.default.access).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return undefined as never;
      }
      throw new Error("ENOENT");
    });

    const result = await detectTestCommand("/workspace");
    expect(result).toBeUndefined();
  });

  it("detects Python pytest from pyproject.toml", async () => {
    const { detectTestCommand } = await import("./marathon-test-loop.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fsMod.default.access).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("pyproject.toml")) {
        return undefined as never;
      }
      throw new Error("ENOENT");
    });

    const result = await detectTestCommand("/workspace");

    expect(result).toBeDefined();
    expect(result!.command).toContain("pytest");
  });

  it("detects Rust cargo test from Cargo.toml", async () => {
    const { detectTestCommand } = await import("./marathon-test-loop.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fsMod.default.access).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("Cargo.toml")) {
        return undefined as never;
      }
      throw new Error("ENOENT");
    });

    const result = await detectTestCommand("/workspace");

    expect(result).toBeDefined();
    expect(result!.command).toContain("cargo test");
  });

  it("detects Go test from go.mod", async () => {
    const { detectTestCommand } = await import("./marathon-test-loop.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fsMod.default.access).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("go.mod")) {
        return undefined as never;
      }
      throw new Error("ENOENT");
    });

    const result = await detectTestCommand("/workspace");

    expect(result).toBeDefined();
    expect(result!.command).toContain("go test ./...");
  });

  it("detects Makefile test target", async () => {
    const { detectTestCommand } = await import("./marathon-test-loop.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readFile).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("Makefile")) {
        return "build:\n\tgo build\n\ntest:\n\tgo test ./...\n" as never;
      }
      throw new Error("ENOENT");
    });

    vi.mocked(fsMod.default.access).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("Makefile")) {
        return undefined as never;
      }
      throw new Error("ENOENT");
    });

    const result = await detectTestCommand("/workspace");

    expect(result).toBeDefined();
    expect(result!.command).toContain("make test");
  });

  it("returns undefined when no test framework detected", async () => {
    const { detectTestCommand } = await import("./marathon-test-loop.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fsMod.default.access).mockRejectedValue(new Error("ENOENT"));

    const result = await detectTestCommand("/workspace");
    expect(result).toBeUndefined();
  });
});

// ── runTestFixLoop ──────────────────────────────────────────────────

describe("runTestFixLoop", () => {
  function createMockContainerManager() {
    return {
      exec: vi.fn(),
      getOrCreate: vi.fn(),
      stop: vi.fn(),
      stopAll: vi.fn(),
      sweepIdle: vi.fn(),
      dispose: vi.fn(),
      promote: vi.fn(),
      demote: vi.fn(),
      setRetention: vi.fn(),
      inspect: vi.fn(),
      reattach: vi.fn(),
      cleanupOrphans: vi.fn(),
    };
  }

  it("returns undefined when no test command detected", async () => {
    const { runTestFixLoop } = await import("./marathon-test-loop.js");
    const fsMod = await import("node:fs/promises");

    // No project files → no test detection
    vi.mocked(fsMod.default.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fsMod.default.access).mockRejectedValue(new Error("ENOENT"));

    const cm = createMockContainerManager();
    const result = await runTestFixLoop({
      chunkName: "setup",
      sessionKey: "marathon:abc",
      workspaceDir: "/workspace",
      containerManager: cm as never,
      config: {
        marathon: {
          testFix: {
            enabled: true,
            maxIterations: 3,
            testTimeoutMs: 120_000,
            maxTestOutputChars: 8000,
          },
        },
      } as never,
      testFixConfig: {
        enabled: true,
        maxIterations: 3,
        testTimeoutMs: 120_000,
        maxTestOutputChars: 8000,
      },
      sessions: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        save: vi.fn(),
        load: vi.fn(),
      },
      chunkTools: [],
      channel: "telegram",
      senderName: "User",
    });

    expect(result).toBeUndefined();
  });

  it("returns testsPassed: true when tests pass on first try", async () => {
    const { runTestFixLoop } = await import("./marathon-test-loop.js");
    const fsMod = await import("node:fs/promises");

    // Detect Node.js test
    vi.mocked(fsMod.default.readFile).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return JSON.stringify({ scripts: { test: "vitest run" } }) as never;
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fsMod.default.access).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return undefined as never;
      }
      throw new Error("ENOENT");
    });

    const cm = createMockContainerManager();
    cm.exec.mockResolvedValue({
      exitCode: 0,
      stdout: "All tests passed",
      stderr: "",
      timedOut: false,
      durationMs: 5000,
    });

    const result = await runTestFixLoop({
      chunkName: "api",
      sessionKey: "marathon:abc",
      workspaceDir: "/workspace",
      containerManager: cm as never,
      config: {
        marathon: {
          testFix: {
            enabled: true,
            maxIterations: 3,
            testTimeoutMs: 120_000,
            maxTestOutputChars: 8000,
          },
        },
      } as never,
      testFixConfig: {
        enabled: true,
        maxIterations: 3,
        testTimeoutMs: 120_000,
        maxTestOutputChars: 8000,
      },
      sessions: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        save: vi.fn(),
        load: vi.fn(),
      },
      chunkTools: [],
      channel: "telegram",
      senderName: "User",
    });

    expect(result).toBeDefined();
    expect(result!.testsPassed).toBe(true);
    expect(result!.fixIterations).toBe(0);
  });

  it("runs fix iterations when tests fail", async () => {
    const { runTestFixLoop } = await import("./marathon-test-loop.js");
    const runner = await import("../agents/runner.js");
    const fsMod = await import("node:fs/promises");

    // Detect Node.js test
    vi.mocked(fsMod.default.readFile).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return JSON.stringify({ scripts: { test: "vitest run" } }) as never;
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fsMod.default.access).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return undefined as never;
      }
      throw new Error("ENOENT");
    });

    const cm = createMockContainerManager();
    // First test run: fail. After fix: pass.
    cm.exec
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "FAIL: 1 test failed",
        timedOut: false,
        durationMs: 3000,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "All tests passed",
        stderr: "",
        timedOut: false,
        durationMs: 3000,
      });

    vi.mocked(runner.runAgent).mockResolvedValue({
      text: "Fixed the test",
      messages: [],
      usage: { inputTokens: 100, outputTokens: 50 },
      durationMs: 5000,
      model: "sonnet",
    });

    const result = await runTestFixLoop({
      chunkName: "api",
      sessionKey: "marathon:abc",
      workspaceDir: "/workspace",
      containerManager: cm as never,
      config: {
        marathon: {
          testFix: {
            enabled: true,
            maxIterations: 3,
            testTimeoutMs: 120_000,
            maxTestOutputChars: 8000,
          },
        },
      } as never,
      testFixConfig: {
        enabled: true,
        maxIterations: 3,
        testTimeoutMs: 120_000,
        maxTestOutputChars: 8000,
      },
      sessions: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        save: vi.fn(),
        load: vi.fn(),
      },
      chunkTools: [],
      channel: "telegram",
      senderName: "User",
    });

    expect(result).toBeDefined();
    expect(result!.testsPassed).toBe(true);
    expect(result!.fixIterations).toBe(1);
  });

  it("returns testsPassed: false after max iterations", async () => {
    const { runTestFixLoop } = await import("./marathon-test-loop.js");
    const runner = await import("../agents/runner.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readFile).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return JSON.stringify({ scripts: { test: "vitest run" } }) as never;
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fsMod.default.access).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return undefined as never;
      }
      throw new Error("ENOENT");
    });

    const cm = createMockContainerManager();
    // All test runs fail
    cm.exec.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "FAIL: still failing",
      timedOut: false,
      durationMs: 3000,
    });

    vi.mocked(runner.runAgent).mockResolvedValue({
      text: "Attempted fix",
      messages: [],
      usage: { inputTokens: 100, outputTokens: 50 },
      durationMs: 5000,
      model: "sonnet",
    });

    const result = await runTestFixLoop({
      chunkName: "api",
      sessionKey: "marathon:abc",
      workspaceDir: "/workspace",
      containerManager: cm as never,
      config: {
        marathon: {
          testFix: {
            enabled: true,
            maxIterations: 2,
            testTimeoutMs: 120_000,
            maxTestOutputChars: 8000,
          },
        },
      } as never,
      testFixConfig: {
        enabled: true,
        maxIterations: 2,
        testTimeoutMs: 120_000,
        maxTestOutputChars: 8000,
      },
      sessions: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        save: vi.fn(),
        load: vi.fn(),
      },
      chunkTools: [],
      channel: "telegram",
      senderName: "User",
    });

    expect(result).toBeDefined();
    expect(result!.testsPassed).toBe(false);
    expect(result!.fixIterations).toBe(2);
    expect(result!.finalTestOutput).toBeDefined();
  });
});

describe("verifyAcceptanceCriteria", () => {
  it("fails unknown criterion formats instead of treating them as informational", async () => {
    const { verifyAcceptanceCriteria } = await import("./marathon-test-loop.js");

    const result = await verifyAcceptanceCriteria({
      criteria: ["lint should pass eventually"],
      workspaceDir: "/workspace",
      sessionKey: "marathon:test",
    });

    expect(result.allPassed).toBe(false);
    expect(result.failCount).toBe(1);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].detail).toContain("Unknown criterion format");
  });
});
