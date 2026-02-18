import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarathonContextConfig } from "../types/config.js";
import type { ChunkResult, MarathonCheckpoint } from "../types/marathon.js";

vi.mock("../infra/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
  },
}));

const defaultContextConfig: MarathonContextConfig = {
  enabled: true,
  maxTreeFiles: 200,
  maxFileBytes: 8192,
  maxTotalChars: 30_000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── listFilesRecursive ──────────────────────────────────────────────

describe("listFilesRecursive", () => {
  it("lists files recursively, skipping node_modules and .git", async () => {
    const { listFilesRecursive } = await import("./marathon-context.js");
    const fsMod = await import("node:fs/promises");

    // Root directory
    vi.mocked(fsMod.default.readdir).mockImplementation(async (dir: unknown) => {
      const d = String(dir);
      if (d === "/workspace") {
        return [
          { name: "package.json", isDirectory: () => false },
          { name: "src", isDirectory: () => true },
          { name: "node_modules", isDirectory: () => true },
          { name: ".git", isDirectory: () => true },
        ] as never;
      }
      if (d === "/workspace/src") {
        return [{ name: "index.ts", isDirectory: () => false }] as never;
      }
      return [] as never;
    });

    const files = await listFilesRecursive("/workspace");

    expect(files).toContain("package.json");
    expect(files).toContain("src/index.ts");
    expect(files).not.toContain("node_modules");
    expect(files).not.toContain(".git");
  });

  it("respects maxFiles limit", async () => {
    const { listFilesRecursive } = await import("./marathon-context.js");
    const fsMod = await import("node:fs/promises");

    const manyFiles = Array.from({ length: 50 }, (_, i) => ({
      name: `file-${i}.txt`,
      isDirectory: () => false,
    }));

    vi.mocked(fsMod.default.readdir).mockResolvedValue(manyFiles as never);

    const files = await listFilesRecursive("/workspace", 10);

    expect(files.length).toBeLessThanOrEqual(10);
  });

  it("handles readdir errors gracefully", async () => {
    const { listFilesRecursive } = await import("./marathon-context.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readdir).mockRejectedValue(new Error("ENOENT"));

    const files = await listFilesRecursive("/nonexistent");
    expect(files).toEqual([]);
  });
});

// ── buildWorkspaceSnapshot ──────────────────────────────────────────

describe("buildWorkspaceSnapshot", () => {
  it("returns empty snapshot when disabled", async () => {
    const { buildWorkspaceSnapshot } = await import("./marathon-context.js");

    const snapshot = await buildWorkspaceSnapshot("/workspace", {
      ...defaultContextConfig,
      enabled: false,
    });

    expect(snapshot.fileTree).toEqual([]);
    expect(snapshot.keyFiles).toEqual([]);
    expect(snapshot.progressMd).toBeUndefined();
  });

  it("includes file tree and key files", async () => {
    const { buildWorkspaceSnapshot } = await import("./marathon-context.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readdir).mockImplementation(async (dir: unknown) => {
      const d = String(dir);
      if (d === "/workspace") {
        return [
          { name: "package.json", isDirectory: () => false },
          { name: "src", isDirectory: () => true },
          { name: "PROGRESS.md", isDirectory: () => false },
        ] as never;
      }
      if (d === "/workspace/src") {
        return [{ name: "index.ts", isDirectory: () => false }] as never;
      }
      return [] as never;
    });

    vi.mocked(fsMod.default.readFile).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("PROGRESS.md")) {
        return "# Marathon Progress\n## Completed: setup" as never;
      }
      if (p.endsWith("package.json")) {
        return '{"name": "my-app", "version": "1.0.0"}' as never;
      }
      throw new Error("ENOENT");
    });

    const snapshot = await buildWorkspaceSnapshot("/workspace", defaultContextConfig);

    expect(snapshot.fileTree).toContain("package.json");
    expect(snapshot.fileTree).toContain("src/index.ts");
    expect(snapshot.fileTree).toContain("PROGRESS.md");
    expect(snapshot.progressMd).toContain("Marathon Progress");
    expect(snapshot.keyFiles.some((f) => f.path === "package.json")).toBe(true);
  });

  it("truncates large key files", async () => {
    const { buildWorkspaceSnapshot } = await import("./marathon-context.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readdir).mockResolvedValue([
      { name: "package.json", isDirectory: () => false },
    ] as never);

    const largeContent = "x".repeat(20_000);
    vi.mocked(fsMod.default.readFile).mockResolvedValue(largeContent as never);

    const snapshot = await buildWorkspaceSnapshot("/workspace", {
      ...defaultContextConfig,
      maxFileBytes: 1000,
    });

    const pkgFile = snapshot.keyFiles.find((f) => f.path === "package.json");
    expect(pkgFile).toBeDefined();
    expect(pkgFile!.content.length).toBeLessThanOrEqual(1020); // 1000 + "... (truncated)"
    expect(pkgFile!.content).toContain("... (truncated)");
  });

  it("drops largest key files when over total budget", async () => {
    const { buildWorkspaceSnapshot } = await import("./marathon-context.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readdir).mockResolvedValue([
      { name: "package.json", isDirectory: () => false },
      { name: "README.md", isDirectory: () => false },
    ] as never);

    vi.mocked(fsMod.default.readFile).mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith("package.json")) {
        return "x".repeat(100) as never; // small
      }
      if (p.endsWith("README.md")) {
        return "y".repeat(5000) as never; // large
      }
      throw new Error("ENOENT");
    });

    const snapshot = await buildWorkspaceSnapshot("/workspace", {
      ...defaultContextConfig,
      maxTotalChars: 200, // Very tight budget
    });

    // README.md (larger) should be dropped to stay under budget
    const readme = snapshot.keyFiles.find((f) => f.path === "README.md");
    expect(readme).toBeUndefined();
  });
});

// ── writeProgressFile ───────────────────────────────────────────────

describe("writeProgressFile", () => {
  it("creates PROGRESS.md when it does not exist", async () => {
    const { writeProgressFile } = await import("./marathon-context.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fsMod.default.writeFile).mockResolvedValue(undefined);

    const checkpoint: MarathonCheckpoint = {
      taskId: "marathon-abc",
      sessionKey: "marathon:abc",
      containerId: "c1",
      status: "executing",
      plan: {
        goal: "Build app",
        chunks: [
          { name: "setup", prompt: "Create project", estimatedMinutes: 5 },
          { name: "api", prompt: "Build API", estimatedMinutes: 10 },
        ],
      },
      currentChunkIndex: 0,
      completedChunks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deliverTo: { channel: "telegram", to: "user123" },
      workspaceDir: "/workspace",
      originSessionKey: "telegram:dm:user123",
      maxRetriesPerChunk: 3,
    };

    const chunkResult: ChunkResult = {
      chunkName: "setup",
      status: "completed",
      summary: "Created Node.js project with Express",
      filesWritten: ["package.json", "src/index.ts"],
      durationMs: 5000,
      completedAt: Date.now(),
      failedAttempts: 0,
    };

    await writeProgressFile("/workspace", checkpoint, chunkResult);

    expect(fsMod.default.writeFile).toHaveBeenCalledWith(
      "/workspace/PROGRESS.md",
      expect.stringContaining("Marathon Progress"),
      "utf-8",
    );
    expect(fsMod.default.writeFile).toHaveBeenCalledWith(
      "/workspace/PROGRESS.md",
      expect.stringContaining("setup (chunk 1/2)"),
      "utf-8",
    );
    expect(fsMod.default.writeFile).toHaveBeenCalledWith(
      "/workspace/PROGRESS.md",
      expect.stringContaining("package.json"),
      "utf-8",
    );
  });

  it("appends to existing PROGRESS.md", async () => {
    const { writeProgressFile } = await import("./marathon-context.js");
    const fsMod = await import("node:fs/promises");

    vi.mocked(fsMod.default.readFile).mockResolvedValue(
      "# Marathon Progress\n\n## Completed: setup (chunk 1/2)\n- Created project\n" as never,
    );
    vi.mocked(fsMod.default.writeFile).mockResolvedValue(undefined);

    const checkpoint: MarathonCheckpoint = {
      taskId: "marathon-abc",
      sessionKey: "marathon:abc",
      containerId: "c1",
      status: "executing",
      plan: {
        goal: "Build app",
        chunks: [
          { name: "setup", prompt: "Create project", estimatedMinutes: 5 },
          { name: "api", prompt: "Build API", estimatedMinutes: 10 },
        ],
      },
      currentChunkIndex: 1,
      completedChunks: [
        {
          chunkName: "setup",
          status: "completed",
          summary: "Done",
          filesWritten: ["package.json"],
          durationMs: 5000,
          completedAt: Date.now(),
          failedAttempts: 0,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deliverTo: { channel: "telegram", to: "user123" },
      workspaceDir: "/workspace",
      originSessionKey: "telegram:dm:user123",
      maxRetriesPerChunk: 3,
    };

    const chunkResult: ChunkResult = {
      chunkName: "api",
      status: "completed",
      summary: "Built REST API endpoints",
      filesWritten: ["src/routes.ts"],
      durationMs: 8000,
      completedAt: Date.now(),
      failedAttempts: 0,
      testStatus: { testsPassed: true, fixIterations: 0, testCommand: "npm test" },
    };

    await writeProgressFile("/workspace", checkpoint, chunkResult);

    const written = vi.mocked(fsMod.default.writeFile).mock.calls[0][1] as string;
    expect(written).toContain("setup (chunk 1/2)"); // existing
    expect(written).toContain("api (chunk 2/2)"); // new
    expect(written).toContain("Tests: passing");
    expect(written).toContain("src/routes.ts");
  });
});
