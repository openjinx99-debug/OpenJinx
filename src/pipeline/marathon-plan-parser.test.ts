/**
 * Unit tests for marathon plan parsing.
 * Tests the three-strategy parser: pure JSON → code block → brace-balanced extraction.
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

const { parsePlanFromResult } = await import("./marathon-prompts.js");

const VALID_PLAN = {
  goal: "Build a calculator",
  chunks: [
    {
      name: "setup",
      prompt: "Create project structure",
      estimatedMinutes: 5,
      acceptanceCriteria: [
        "file_exists: package.json",
        "command_succeeds: cd /workspace && npm test",
      ],
    },
    {
      name: "logic",
      prompt: "Implement logic",
      estimatedMinutes: 10,
      acceptanceCriteria: ["file_exists: src/index.ts", "file_contains: src/index.ts :: export"],
    },
  ],
};

describe("parsePlanFromResult", () => {
  it("parses pure JSON response", () => {
    const text = JSON.stringify(VALID_PLAN);
    const result = parsePlanFromResult(text);
    expect(result).toBeDefined();
    expect(result!.goal).toBe("Build a calculator");
    expect(result!.chunks).toHaveLength(2);
  });

  it("parses JSON in markdown code block", () => {
    const text = `Here's the plan:\n\n\`\`\`json\n${JSON.stringify(VALID_PLAN, null, 2)}\n\`\`\`\n\nLet me know if you'd like changes.`;
    const result = parsePlanFromResult(text);
    expect(result).toBeDefined();
    expect(result!.goal).toBe("Build a calculator");
    expect(result!.chunks).toHaveLength(2);
  });

  it("parses JSON embedded in prose (brace-balanced extraction)", () => {
    const text = `I'll decompose this into the following plan:\n\n${JSON.stringify(VALID_PLAN)}\n\nThis should take about 15 minutes total.`;
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
            "command_succeeds: cd /workspace && npm test",
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
});
