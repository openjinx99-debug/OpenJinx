import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { TranscriptTurn } from "../types/sessions.js";
import {
  needsCompaction,
  buildCompactionTurn,
  selectTurnsForCompaction,
  buildCompactionPrompt,
  estimateTurnTokens,
  estimateTranscriptTokens,
  compactTranscript,
} from "./compaction.js";
import { appendTranscriptTurn, readTranscript } from "./transcript.js";

const makeTurn = (role: "user" | "assistant", text: string): TranscriptTurn => ({
  role,
  text,
  timestamp: Date.now(),
});

describe("needsCompaction", () => {
  it("returns true when over 80% of context", () => {
    expect(needsCompaction(161_000, 200_000)).toBe(true);
  });

  it("returns false when under threshold", () => {
    expect(needsCompaction(100_000, 200_000)).toBe(false);
  });

  it("returns true at exactly 80%", () => {
    expect(needsCompaction(160_001, 200_000)).toBe(true);
  });
});

describe("buildCompactionTurn", () => {
  it("creates a system turn with summary", () => {
    const turns = [makeTurn("user", "hello"), makeTurn("assistant", "hi")];
    const turn = buildCompactionTurn(turns, "User said hello, agent replied.");
    expect(turn.role).toBe("system");
    expect(turn.text).toContain("2 turns summarized");
    expect(turn.text).toContain("User said hello");
    expect(turn.isCompaction).toBe(true);
  });
});

describe("selectTurnsForCompaction", () => {
  it("keeps recent turns and compacts older ones", () => {
    const turns = Array.from({ length: 10 }, (_, i) => makeTurn("user", `msg-${i}`));
    const [toCompact, toKeep] = selectTurnsForCompaction(turns, 4);
    expect(toCompact).toHaveLength(6);
    expect(toKeep).toHaveLength(4);
    expect(toKeep[0].text).toBe("msg-6");
  });

  it("returns empty compact list when fewer turns than keepRecent", () => {
    const turns = [makeTurn("user", "a"), makeTurn("assistant", "b")];
    const [toCompact, toKeep] = selectTurnsForCompaction(turns, 4);
    expect(toCompact).toHaveLength(0);
    expect(toKeep).toHaveLength(2);
  });
});

describe("buildCompactionPrompt", () => {
  it("includes turn content", () => {
    const turns = [makeTurn("user", "what is 2+2?"), makeTurn("assistant", "4")];
    const prompt = buildCompactionPrompt(turns);
    expect(prompt).toContain("what is 2+2?");
    expect(prompt).toContain("[user]");
    expect(prompt).toContain("[assistant]");
  });
});

describe("estimateTurnTokens", () => {
  it("estimates tokens from text length", () => {
    // 20 chars / 4 chars per token = 5 tokens
    const turn = makeTurn("user", "a]".repeat(10));
    expect(estimateTurnTokens(turn)).toBe(5);
  });

  it("includes tool calls in estimate", () => {
    const turn: TranscriptTurn = {
      role: "assistant",
      text: "done",
      timestamp: Date.now(),
      toolCalls: [{ toolName: "read_file", input: { path: "/foo" }, output: "contents here" }],
    };
    const tokensWithTools = estimateTurnTokens(turn);
    const textOnly = estimateTurnTokens(makeTurn("assistant", "done"));
    expect(tokensWithTools).toBeGreaterThan(textOnly);
  });

  it("handles empty text", () => {
    const turn = makeTurn("user", "");
    expect(estimateTurnTokens(turn)).toBe(0);
  });
});

describe("estimateTranscriptTokens", () => {
  it("sums tokens across all turns", () => {
    // Each turn: 8 chars / 4 = 2 tokens
    const turns = [makeTurn("user", "12345678"), makeTurn("assistant", "abcdefgh")];
    expect(estimateTranscriptTokens(turns)).toBe(4);
  });

  it("returns 0 for empty array", () => {
    expect(estimateTranscriptTokens([])).toBe(0);
  });
});

describe("compactTranscript", () => {
  let tmpDir: string;
  let transcriptPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jinx-compact-"));
    transcriptPath = path.join(tmpDir, "test.jsonl");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("compacts when over threshold", async () => {
    // Write many long turns to exceed threshold
    // contextWindow = 100 tokens, threshold = 80 tokens
    // Each turn: 400 chars / 4 = 100 tokens, so 2 turns = 200 tokens (way over 80)
    const longText = "x".repeat(400);
    for (let i = 0; i < 10; i++) {
      await appendTranscriptTurn(
        transcriptPath,
        makeTurn(i % 2 === 0 ? "user" : "assistant", longText),
      );
    }

    const summarize = vi.fn().mockResolvedValue("This is a summary of the conversation.");
    const result = await compactTranscript(transcriptPath, 100, summarize);

    expect(result.compacted).toBe(true);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    expect(summarize).toHaveBeenCalledOnce();

    // Verify transcript was rewritten
    const turns = await readTranscript(transcriptPath);
    // Should have compaction turn + 4 kept turns = 5
    expect(turns).toHaveLength(5);
    expect(turns[0].role).toBe("system");
    expect(turns[0].isCompaction).toBe(true);
    expect(turns[0].text).toContain("This is a summary");
  });

  it("does not compact when under threshold", async () => {
    // 2 short turns, contextWindow = 200_000 — way under threshold
    await appendTranscriptTurn(transcriptPath, makeTurn("user", "hello"));
    await appendTranscriptTurn(transcriptPath, makeTurn("assistant", "hi"));

    const summarize = vi.fn();
    const result = await compactTranscript(transcriptPath, 200_000, summarize);

    expect(result.compacted).toBe(false);
    expect(result.tokensBefore).toBe(result.tokensAfter);
    expect(summarize).not.toHaveBeenCalled();
  });

  it("does not compact when too few turns to split", async () => {
    // Only 3 turns, keepRecent=4 means nothing to compact
    // But we need to be over threshold — use a tiny context window
    const longText = "x".repeat(400);
    for (let i = 0; i < 3; i++) {
      await appendTranscriptTurn(transcriptPath, makeTurn("user", longText));
    }

    const summarize = vi.fn();
    const result = await compactTranscript(transcriptPath, 10, summarize);

    expect(result.compacted).toBe(false);
    expect(summarize).not.toHaveBeenCalled();
  });
});
