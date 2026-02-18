import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../pipeline/checkpoint.js", () => ({
  readCheckpoint: vi.fn(),
  patchCheckpoint: vi.fn(),
  listCheckpoints: vi.fn().mockResolvedValue([]),
  resolveMarathonDir: vi.fn().mockReturnValue("/tmp/marathon"),
}));

vi.mock("../../infra/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockReadCheckpoint = vi.fn();
const mockPatchCheckpoint = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  const checkpoint = await import("../../pipeline/checkpoint.js");
  vi.mocked(checkpoint.readCheckpoint).mockImplementation(mockReadCheckpoint);
  vi.mocked(checkpoint.patchCheckpoint).mockImplementation(mockPatchCheckpoint);
});

const { getMarathonToolDefinitions } = await import("./marathon-tools.js");

const sampleCheckpoint = {
  taskId: "marathon-abc12345",
  sessionKey: "marathon:abc12345",
  containerId: "jinx-marathon-abc12345",
  status: "executing" as const,
  plan: {
    goal: "Build a todo app",
    chunks: [
      {
        name: "scaffold",
        prompt: "Create project structure",
        estimatedMinutes: 5,
        acceptanceCriteria: [
          "file_exists: package.json",
          "command_succeeds: cd /workspace && npm run -s lint",
        ],
      },
      {
        name: "api",
        prompt: "Build REST API",
        estimatedMinutes: 10,
        acceptanceCriteria: [
          "file_exists: src/server.ts",
          "file_contains: src/server.ts :: export",
        ],
      },
      {
        name: "tests",
        prompt: "Write tests",
        estimatedMinutes: 10,
        acceptanceCriteria: [
          "tests_pass",
          "command_succeeds: cd /workspace && npm run -s test",
        ],
      },
    ],
  },
  currentChunkIndex: 1,
  completedChunks: [
    {
      chunkName: "scaffold",
      status: "completed" as const,
      summary: "Created project",
      filesWritten: ["package.json"],
      durationMs: 30000,
      completedAt: Date.now(),
      failedAttempts: 0,
    },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deliverTo: { channel: "telegram" as const, to: "user123" },
  workspaceDir: "/tmp/tasks/marathon-abc12345",
  originSessionKey: "telegram:dm:user123",
  maxRetriesPerChunk: 3,
};

describe("marathon_status tool", () => {
  it("returns checkpoint status with progress info", async () => {
    mockReadCheckpoint.mockResolvedValue(sampleCheckpoint);

    const tools = getMarathonToolDefinitions({ taskId: "marathon-abc12345" });
    const statusTool = tools.find((t) => t.name === "marathon_status")!;

    const result = (await statusTool.execute({})) as Record<string, unknown>;
    expect(result.taskId).toBe("marathon-abc12345");
    expect(result.status).toBe("executing");
    expect(result.progress).toBe("1/3");
    expect(result.currentChunk).toBe("api");
    expect((result.remainingChunks as string[]).length).toBe(1);
    expect((result.remainingChunks as string[])[0]).toBe("tests");
  });

  it("returns error for unknown task", async () => {
    mockReadCheckpoint.mockResolvedValue(undefined);

    const tools = getMarathonToolDefinitions({ taskId: "unknown" });
    const statusTool = tools.find((t) => t.name === "marathon_status")!;

    const result = (await statusTool.execute({})) as Record<string, unknown>;
    expect(result.error).toBeDefined();
  });
});

describe("marathon_plan_update tool", () => {
  it("replaces future chunks only", async () => {
    mockReadCheckpoint.mockResolvedValue(structuredClone(sampleCheckpoint));
    mockPatchCheckpoint.mockResolvedValue(undefined);

    const tools = getMarathonToolDefinitions({ taskId: "marathon-abc12345" });
    const updateTool = tools.find((t) => t.name === "marathon_plan_update")!;

    const result = (await updateTool.execute({
      chunks: [
        {
          name: "new-feature",
          prompt: "Add new feature",
          estimatedMinutes: 15,
          acceptanceCriteria: [
            "file_exists: src/new-feature.ts",
            "command_succeeds: cd /workspace && npm run -s test",
          ],
        },
      ],
    })) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.totalChunks).toBe(3); // scaffold + api (current) + new-feature
    expect((result.remainingChunks as string[])[0]).toBe("new-feature");
    expect(mockPatchCheckpoint).toHaveBeenCalledWith(
      "marathon-abc12345",
      expect.objectContaining({
        plan: expect.objectContaining({
          chunks: expect.arrayContaining([
            expect.objectContaining({ name: "scaffold" }),
            expect.objectContaining({ name: "api" }),
            expect.objectContaining({ name: "new-feature" }),
          ]),
        }),
      }),
    );
  });

  it("rejects plan updates with missing acceptance criteria and preserves existing plan", async () => {
    mockReadCheckpoint.mockResolvedValue(structuredClone(sampleCheckpoint));
    mockPatchCheckpoint.mockResolvedValue(undefined);

    const tools = getMarathonToolDefinitions({ taskId: "marathon-abc12345" });
    const updateTool = tools.find((t) => t.name === "marathon_plan_update")!;

    const result = (await updateTool.execute({
      chunks: [{ name: "bad", prompt: "No criteria", estimatedMinutes: 5 }],
    })) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("Plan update rejected");
    expect(result.details).toBeDefined();
    expect(mockPatchCheckpoint).not.toHaveBeenCalled();
  });
});
