import { describe, expect, it, vi } from "vitest";

// Mock the claude provider before importing classifier
const mockRunAgentTurn = vi.fn();
vi.mock("../providers/claude-provider.js", () => ({
  runAgentTurn: mockRunAgentTurn,
}));

const { classifyTask } = await import("./classifier.js");

describe("classifyTask", () => {
  it("returns quick for short messages without LLM call", async () => {
    const result = await classifyTask("hello", "haiku");

    expect(result.classification).toBe("quick");
    expect(result.reason).toBe("short message");
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
  });

  it("returns quick for messages under 20 chars without LLM call", async () => {
    const result = await classifyTask("what time is it?", "haiku");

    expect(result.classification).toBe("quick");
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
  });

  it("calls LLM for messages >= 20 chars and returns deep", async () => {
    mockRunAgentTurn.mockResolvedValueOnce({
      text: '{"classification":"deep","reason":"multi-step research"}',
      messages: [],
      hitTurnLimit: false,
      usage: { inputTokens: 100, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 200,
      model: "haiku",
    });

    const result = await classifyTask(
      "Compare the performance characteristics of Redis vs Memcached for session caching",
      "haiku",
    );

    expect(result.classification).toBe("deep");
    expect(result.reason).toBe("multi-step research");
    expect(mockRunAgentTurn).toHaveBeenCalledOnce();
    expect(mockRunAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "haiku",
        maxTurns: 1,
      }),
    );
  });

  it("calls LLM for messages >= 20 chars and returns quick", async () => {
    mockRunAgentTurn.mockResolvedValueOnce({
      text: '{"classification":"quick","reason":"simple question"}',
      messages: [],
      hitTurnLimit: false,
      usage: { inputTokens: 80, outputTokens: 15, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 150,
      model: "haiku",
    });

    const result = await classifyTask("What is the capital of France?", "haiku");

    expect(result.classification).toBe("quick");
    expect(result.reason).toBe("simple question");
  });

  it("extracts JSON from markdown-fenced response", async () => {
    mockRunAgentTurn.mockResolvedValueOnce({
      text: '```json\n{"classification":"deep","reason":"comparative analysis"}\n```',
      messages: [],
      hitTurnLimit: false,
      usage: { inputTokens: 80, outputTokens: 15, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 150,
      model: "haiku",
    });

    const result = await classifyTask(
      "This is a longer message that needs classification",
      "haiku",
    );

    expect(result.classification).toBe("deep");
    expect(result.reason).toBe("comparative analysis");
  });

  it("extracts JSON from response with surrounding prose", async () => {
    mockRunAgentTurn.mockResolvedValueOnce({
      text: 'Here is my classification:\n{"classification":"deep","reason":"multi-step task"}\nThat is my assessment.',
      messages: [],
      hitTurnLimit: false,
      usage: { inputTokens: 80, outputTokens: 15, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 150,
      model: "haiku",
    });

    const result = await classifyTask(
      "This is a longer message that needs classification",
      "haiku",
    );

    expect(result.classification).toBe("deep");
    expect(result.reason).toBe("multi-step task");
  });

  it("falls back to quick on completely unparseable response", async () => {
    mockRunAgentTurn.mockResolvedValueOnce({
      text: "I think this is a quick message with no JSON at all",
      messages: [],
      hitTurnLimit: false,
      usage: { inputTokens: 80, outputTokens: 15, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 150,
      model: "haiku",
    });

    const result = await classifyTask(
      "This is a longer message that needs classification",
      "haiku",
    );

    expect(result.classification).toBe("quick");
    expect(result.reason).toBe("unparseable classifier response");
  });

  it("falls back to quick on invalid classification value", async () => {
    mockRunAgentTurn.mockResolvedValueOnce({
      text: '{"classification":"medium","reason":"somewhat complex"}',
      messages: [],
      hitTurnLimit: false,
      usage: { inputTokens: 80, outputTokens: 15, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 150,
      model: "haiku",
    });

    const result = await classifyTask(
      "This is a longer message that needs classification",
      "haiku",
    );

    expect(result.classification).toBe("quick");
    expect(result.reason).toBe("invalid classifier response");
  });

  it("classifies 'build me a full-stack app' as marathon", async () => {
    mockRunAgentTurn.mockResolvedValueOnce({
      text: '{"classification":"marathon","reason":"large-scale project request"}',
      messages: [],
      hitTurnLimit: false,
      usage: { inputTokens: 100, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 200,
      model: "haiku",
    });

    const result = await classifyTask(
      "Build me a full-stack app with React frontend, Express backend, and PostgreSQL database",
      "haiku",
    );

    expect(result.classification).toBe("marathon");
    expect(result.reason).toBe("large-scale project request");
  });

  it("classifies 'create a REST API with tests and deployment' as marathon", async () => {
    mockRunAgentTurn.mockResolvedValueOnce({
      text: '{"classification":"marathon","reason":"multi-hour autonomous build"}',
      messages: [],
      hitTurnLimit: false,
      usage: { inputTokens: 100, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 200,
      model: "haiku",
    });

    const result = await classifyTask(
      "Create a REST API with full test coverage and deployment configuration",
      "haiku",
    );

    expect(result.classification).toBe("marathon");
  });

  it("still classifies 'what time is it' as quick", async () => {
    // Under 20 chars, no LLM call
    const result = await classifyTask("what time is it?", "haiku");
    expect(result.classification).toBe("quick");
  });

  it("still classifies 'write a function' as deep", async () => {
    mockRunAgentTurn.mockResolvedValueOnce({
      text: '{"classification":"deep","reason":"code generation task"}',
      messages: [],
      hitTurnLimit: false,
      usage: { inputTokens: 80, outputTokens: 15, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 150,
      model: "haiku",
    });

    const result = await classifyTask(
      "Write a function that sorts an array using quicksort algorithm",
      "haiku",
    );

    expect(result.classification).toBe("deep");
  });

  it("falls back to quick when provider throws", async () => {
    mockRunAgentTurn.mockRejectedValueOnce(new Error("API rate limit exceeded"));

    const result = await classifyTask(
      "This is a longer message that needs classification",
      "haiku",
    );

    expect(result.classification).toBe("quick");
    expect(result.reason).toBe("classifier error");
  });
});
