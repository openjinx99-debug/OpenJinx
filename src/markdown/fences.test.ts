import { describe, expect, it } from "vitest";
import { findFenceSpanAt, isSafeFenceBreak, parseFenceSpans } from "./fences.js";

describe("parseFenceSpans", () => {
  it("detects a backtick fenced code block", () => {
    const input = "before\n```js\ncode\n```\nafter";
    const spans = parseFenceSpans(input);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.openLine).toBe("```js");
    expect(spans[0]!.marker).toBe("```");
  });

  it("detects a tilde fenced code block", () => {
    const input = "~~~\ncode\n~~~";
    const spans = parseFenceSpans(input);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.marker).toBe("~~~");
  });

  it("handles unclosed fence (extends to end)", () => {
    const input = "```\ncode here";
    const spans = parseFenceSpans(input);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.end).toBe(input.length);
  });

  it("returns empty for no fences", () => {
    expect(parseFenceSpans("hello world")).toEqual([]);
  });

  it("detects multiple fences", () => {
    const input = "```\na\n```\n```\nb\n```";
    const spans = parseFenceSpans(input);
    expect(spans).toHaveLength(2);
  });
});

describe("findFenceSpanAt", () => {
  it("returns the span containing the index", () => {
    const spans = parseFenceSpans("```\ncode\n```");
    const found = findFenceSpanAt(spans, 5);
    expect(found).toBeDefined();
  });

  it("returns undefined outside fence", () => {
    const spans = parseFenceSpans("before\n```\ncode\n```\nafter");
    expect(findFenceSpanAt(spans, 2)).toBeUndefined();
  });
});

describe("isSafeFenceBreak", () => {
  it("returns true outside a fence", () => {
    const spans = parseFenceSpans("before\n```\ncode\n```\nafter");
    expect(isSafeFenceBreak(spans, 3)).toBe(true);
  });

  it("returns false inside a fence", () => {
    const spans = parseFenceSpans("```\ncode\n```");
    expect(isSafeFenceBreak(spans, 5)).toBe(false);
  });
});
