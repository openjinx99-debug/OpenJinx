import { describe, expect, it } from "vitest";
import { chunkText, scanParenAwareBreakpoints } from "./chunk.js";

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("returns empty array for empty text", () => {
    expect(chunkText("", 100)).toEqual([]);
  });

  it("returns original for non-positive limit", () => {
    expect(chunkText("hello", 0)).toEqual(["hello"]);
  });

  it("splits on newline boundaries", () => {
    const text = "aaa\nbbb\nccc";
    const chunks = chunkText(text, 5);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(5);
    }
  });

  it("splits on whitespace when no newline", () => {
    const text = "aaa bbb ccc";
    const chunks = chunkText(text, 5);
    expect(chunks).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("hard-breaks at limit when no whitespace", () => {
    const text = "abcdefghij";
    const chunks = chunkText(text, 5);
    expect(chunks).toEqual(["abcde", "fghij"]);
  });

  it("preserves all content across chunks", () => {
    const text = "word ".repeat(50).trim();
    const chunks = chunkText(text, 20);
    const joined = chunks.join(" ");
    expect(joined).toContain("word");
    expect(chunks.every((c) => c.length <= 20)).toBe(true);
  });
});

describe("scanParenAwareBreakpoints", () => {
  it("finds last newline and whitespace", () => {
    const result = scanParenAwareBreakpoints("abc\ndef ghi");
    expect(result.lastNewline).toBe(3);
    expect(result.lastWhitespace).toBe(7);
  });

  it("ignores whitespace inside parentheses", () => {
    const result = scanParenAwareBreakpoints("fn(a b) end");
    // The space inside fn(a b) is at depth > 0, so ignored
    expect(result.lastWhitespace).toBe(7); // space before "end"
  });

  it("respects isAllowed filter", () => {
    const result = scanParenAwareBreakpoints("a b c", (i) => i !== 1);
    // Position 1 is space but filtered out, so lastWhitespace should be at 3
    expect(result.lastWhitespace).toBe(3);
  });
});
