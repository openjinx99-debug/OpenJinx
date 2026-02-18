/**
 * Unit tests for marathon prompt builders and plan parser.
 * Moved from marathon-plan-parser.test.ts + new tests for enhanced prompts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../infra/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const {
  parsePlanFromResult,
  buildPlanningPrompt,
  buildPlanningRepairPrompt,
  buildChunkPrompt,
  buildTestFixPrompt,
  formatFileSize,
} = await import("./marathon-prompts.js");

const VALID_PLAN = {
  goal: "Build a calculator",
  chunks: [
    {
      name: "setup",
      prompt: "Create project structure",
      estimatedMinutes: 5,
      acceptanceCriteria: [
        "file_exists: package.json",
        "command_succeeds: cd /workspace && npm run -s test:unit",
      ],
    },
    {
      name: "logic",
      prompt: "Implement logic",
      estimatedMinutes: 10,
      acceptanceCriteria: [
        "file_exists: src/logic.ts",
        "file_contains: src/logic.ts :: export function add",
      ],
    },
  ],
};

const PLAN_WITH_CRITERIA = {
  goal: "Build a calculator",
  chunks: [
    {
      name: "setup",
      prompt: "Create project structure",
      estimatedMinutes: 5,
      acceptanceCriteria: [
        "file_exists: package.json",
        "command_succeeds: cd /workspace && npm run -s build",
      ],
    },
    {
      name: "logic",
      prompt: "Implement logic",
      estimatedMinutes: 10,
      acceptanceCriteria: ["file_contains: src/calculator.ts :: export function add", "tests_pass"],
    },
  ],
};

// ── parsePlanFromResult ─────────────────────────────────────────────

describe("parsePlanFromResult", () => {
  it("parses pure JSON response", () => {
    const text = JSON.stringify(VALID_PLAN);
    const result = parsePlanFromResult(text);
    expect(result).toBeDefined();
    expect(result!.goal).toBe("Build a calculator");
    expect(result!.chunks).toHaveLength(2);
  });

  it("parses JSON in markdown code block", () => {
    const text = `Here's the plan:\n\n\`\`\`json\n${JSON.stringify(VALID_PLAN, null, 2)}\n\`\`\`\n\nLet me know.`;
    const result = parsePlanFromResult(text);
    expect(result).toBeDefined();
    expect(result!.goal).toBe("Build a calculator");
    expect(result!.chunks).toHaveLength(2);
  });

  it("parses JSON embedded in prose (brace-balanced extraction)", () => {
    const text = `I'll decompose this:\n\n${JSON.stringify(VALID_PLAN)}\n\nThis should take ~15 min.`;
    const result = parsePlanFromResult(text);
    expect(result).toBeDefined();
    expect(result!.chunks).toHaveLength(2);
  });

  it("handles LLM response with multiple JSON objects (picks the one with chunks)", () => {
    const metadata = JSON.stringify({ thinking: "let me plan", confidence: 0.95 });
    const text = `${metadata}\n\nHere's the plan:\n${JSON.stringify(VALID_PLAN)}`;
    const result = parsePlanFromResult(text);
    expect(result).toBeDefined();
    expect(result!.goal).toBe("Build a calculator");
  });

  it("parses plan with acceptanceCriteria", () => {
    const text = JSON.stringify(PLAN_WITH_CRITERIA);
    const result = parsePlanFromResult(text);
    expect(result).toBeDefined();
    expect(result!.chunks[0].acceptanceCriteria).toEqual([
      "file_exists: package.json",
      "command_succeeds: cd /workspace && npm run -s build",
    ]);
  });

  it("returns undefined for empty response", () => {
    expect(parsePlanFromResult("")).toBeUndefined();
  });

  it("returns undefined for response with no JSON", () => {
    expect(parsePlanFromResult("I can't decompose this task.")).toBeUndefined();
  });

  it("returns undefined for JSON missing 'goal'", () => {
    const noGoal = { chunks: [{ name: "a", prompt: "b", estimatedMinutes: 5 }] };
    expect(parsePlanFromResult(JSON.stringify(noGoal))).toBeUndefined();
  });

  it("returns undefined for JSON with empty 'chunks' array", () => {
    const emptyChunks = { goal: "Build app", chunks: [] };
    expect(parsePlanFromResult(JSON.stringify(emptyChunks))).toBeUndefined();
  });

  it("returns undefined for chunk missing 'name'", () => {
    const badChunk = {
      goal: "Build app",
      chunks: [{ prompt: "do stuff", estimatedMinutes: 5 }],
    };
    expect(parsePlanFromResult(JSON.stringify(badChunk))).toBeUndefined();
  });

  it("returns undefined for chunk missing 'prompt'", () => {
    const badChunk = {
      goal: "Build app",
      chunks: [{ name: "setup", estimatedMinutes: 5 }],
    };
    expect(parsePlanFromResult(JSON.stringify(badChunk))).toBeUndefined();
  });

  it("handles goal with special characters including braces", () => {
    const plan = {
      goal: "Build {REST API} with (auth)",
      chunks: [
        {
          name: "setup",
          prompt: "Create project",
          estimatedMinutes: 5,
          acceptanceCriteria: [
            "file_exists: package.json",
            "command_succeeds: cd /workspace && npm run -s test",
          ],
        },
      ],
    };
    const result = parsePlanFromResult(JSON.stringify(plan));
    expect(result).toBeDefined();
    expect(result!.goal).toBe("Build {REST API} with (auth)");
  });

  it("handles code block without json language specifier", () => {
    const text = `\`\`\`\n${JSON.stringify(VALID_PLAN, null, 2)}\n\`\`\``;
    const result = parsePlanFromResult(text);
    expect(result).toBeDefined();
    expect(result!.chunks).toHaveLength(2);
  });

  it("rejects chunk when acceptanceCriteria is missing", () => {
    const text = JSON.stringify({
      goal: "Build app",
      chunks: [{ name: "setup", prompt: "Create project", estimatedMinutes: 5 }],
    });
    expect(parsePlanFromResult(text)).toBeUndefined();
  });

  it("rejects chunk when acceptanceCriteria includes unknown format", () => {
    const text = JSON.stringify({
      goal: "Build app",
      chunks: [
        {
          name: "setup",
          prompt: "Create project",
          estimatedMinutes: 5,
          acceptanceCriteria: ["package.json exists", "tests pass"],
        },
      ],
    });
    expect(parsePlanFromResult(text)).toBeUndefined();
  });

  it("rejects chunk when fewer than 2 acceptanceCriteria are provided", () => {
    const text = JSON.stringify({
      goal: "Build app",
      chunks: [
        {
          name: "setup",
          prompt: "Create project",
          estimatedMinutes: 5,
          acceptanceCriteria: ["file_exists: package.json"],
        },
      ],
    });
    expect(parsePlanFromResult(text)).toBeUndefined();
  });
});

// ── buildPlanningPrompt ─────────────────────────────────────────────

describe("buildPlanningPrompt", () => {
  it("includes user prompt and maxChunks", () => {
    const prompt = buildPlanningPrompt("Build a todo app", 10);
    expect(prompt).toContain("Build a todo app");
    expect(prompt).toContain("Hard cap: 10 chunks");
  });

  it("includes input files section when provided", () => {
    const prompt = buildPlanningPrompt("Compress video", 10, [
      { name: "clip.mp4", sizeBytes: 1024 * 1024, mimeType: "video/mp4" },
    ]);
    expect(prompt).toContain("INPUT FILES (already in /workspace):");
    expect(prompt).toContain("clip.mp4");
    expect(prompt).toContain("video/mp4");
  });

  it("requests acceptanceCriteria in output format", () => {
    const prompt = buildPlanningPrompt("Build something", 10);
    expect(prompt).toContain("acceptanceCriteria");
    expect(prompt).toContain("testable");
  });
});

describe("buildPlanningRepairPrompt", () => {
  it("includes prior invalid response and strict JSON instructions", () => {
    const prompt = buildPlanningRepairPrompt(
      "Build an API",
      6,
      "I will now think out loud and then give JSON...",
      [{ name: "input.txt", sizeBytes: 100, mimeType: "text/plain" }],
    );
    expect(prompt).toContain("previous marathon plan response was invalid");
    expect(prompt).toContain("I will now think out loud");
    expect(prompt).toContain("Return ONLY valid JSON");
    expect(prompt).toContain("input.txt");
    expect(prompt).toContain("1-6 chunks");
  });
});

// ── buildChunkPrompt ────────────────────────────────────────────────

describe("buildChunkPrompt", () => {
  const baseCheckpoint = {
    taskId: "marathon-abc",
    sessionKey: "marathon:abc",
    containerId: "container-1",
    status: "executing" as const,
    plan: {
      goal: "Build a todo app",
      chunks: [
        { name: "setup", prompt: "Create project", estimatedMinutes: 5, acceptanceCriteria: [] },
        { name: "api", prompt: "Build API", estimatedMinutes: 10, acceptanceCriteria: [] },
      ],
    },
    currentChunkIndex: 0,
    completedChunks: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deliverTo: { channel: "telegram" as const, to: "user123" },
    workspaceDir: "/tmp/workspace",
    originSessionKey: "telegram:dm:user123",
    maxRetriesPerChunk: 3,
  };

  it("includes overall goal and chunk info", () => {
    const prompt = buildChunkPrompt(
      baseCheckpoint,
      { name: "setup", prompt: "Create project", estimatedMinutes: 5, acceptanceCriteria: [] },
      false,
    );
    expect(prompt).toContain("Build a todo app");
    expect(prompt).toContain("CURRENT CHUNK: setup");
    expect(prompt).toContain("chunk 1 of 2");
  });

  it("includes workspace snapshot when provided", () => {
    const prompt = buildChunkPrompt(
      { ...baseCheckpoint, currentChunkIndex: 1 },
      { name: "api", prompt: "Build API", estimatedMinutes: 10, acceptanceCriteria: [] },
      true,
      {
        fileTree: ["package.json", "src/index.ts"],
        keyFiles: [{ path: "package.json", content: '{"name": "todo"}' }],
        progressMd: "# Marathon Progress\n\n## Completed: setup",
      },
    );
    expect(prompt).toContain("WORKSPACE STATE:");
    expect(prompt).toContain("PROGRESS.md (read this first)");
    expect(prompt).toContain("Marathon Progress");
    expect(prompt).toContain("File Tree (2 files)");
    expect(prompt).toContain("package.json");
  });

  it("includes acceptance criteria when present", () => {
    const prompt = buildChunkPrompt(
      baseCheckpoint,
      {
        name: "setup",
        prompt: "Create project",
        estimatedMinutes: 5,
        acceptanceCriteria: ["package.json exists", "tests run"],
      },
      false,
    );
    expect(prompt).toContain("ACCEPTANCE CRITERIA");
    expect(prompt).toContain("package.json exists");
    expect(prompt).toContain("tests run");
  });

  it("includes DELIVERABLES instruction on last chunk", () => {
    const prompt = buildChunkPrompt(
      baseCheckpoint,
      { name: "setup", prompt: "Create project", estimatedMinutes: 5, acceptanceCriteria: [] },
      true,
    );
    expect(prompt).toContain("DELIVERABLES");
    expect(prompt).toContain(".deliverables");
  });

  it("does not include DELIVERABLES on non-last chunk", () => {
    const prompt = buildChunkPrompt(
      baseCheckpoint,
      { name: "setup", prompt: "Create project", estimatedMinutes: 5, acceptanceCriteria: [] },
      false,
    );
    expect(prompt).not.toContain("DELIVERABLES");
  });

  it("includes input files section from checkpoint", () => {
    const prompt = buildChunkPrompt(
      {
        ...baseCheckpoint,
        inputFiles: [{ name: "test.mp4", sizeBytes: 2_000_000, mimeType: "video/mp4" }],
      },
      { name: "setup", prompt: "Create project", estimatedMinutes: 5, acceptanceCriteria: [] },
      false,
    );
    expect(prompt).toContain("INPUT FILES (user-provided, already in /workspace):");
    expect(prompt).toContain("test.mp4");
  });

  it("includes PROGRESS.md reading instruction", () => {
    const prompt = buildChunkPrompt(
      baseCheckpoint,
      { name: "setup", prompt: "Create project", estimatedMinutes: 5, acceptanceCriteria: [] },
      false,
    );
    expect(prompt).toContain("Read PROGRESS.md first");
  });
});

// ── buildTestFixPrompt ──────────────────────────────────────────────

describe("buildTestFixPrompt", () => {
  it("includes chunk name, test command, and output", () => {
    const prompt = buildTestFixPrompt("api", "npm test", "FAIL: 2 tests failed", 1, 3);
    expect(prompt).toContain('chunk "api"');
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("FAIL: 2 tests failed");
    expect(prompt).toContain("attempt 1/3");
  });

  it("includes targeted fix instruction", () => {
    const prompt = buildTestFixPrompt("api", "npm test", "error", 2, 3);
    expect(prompt).toContain("targeted fixes");
    expect(prompt).toContain("do NOT rewrite from scratch");
  });
});

// ── formatFileSize ──────────────────────────────────────────────────

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(5120)).toBe("5.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(2_500_000)).toBe("2.4 MB");
  });
});
