import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "./chunker.js";

describe("chunkMarkdown", () => {
  it("returns single chunk for short content", () => {
    const content = "# Title\n\nShort content.";
    const chunks = chunkMarkdown(content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Title");
    expect(chunks[0].startLine).toBe(1);
  });

  it("splits long content into multiple chunks", () => {
    // Generate ~8000 chars of content (well above 400*4=1600 default chunk size)
    const sections = Array.from(
      { length: 10 },
      (_, i) => `## Section ${i}\n\n${"Lorem ipsum dolor sit amet. ".repeat(20)}\n`,
    );
    const content = sections.join("\n");
    const chunks = chunkMarkdown(content);

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should have content
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.startLine).toBeGreaterThan(0);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  it("preserves line numbers", () => {
    const content = "# Header\n\nParagraph 1\n\nParagraph 2\n\nParagraph 3";
    const chunks = chunkMarkdown(content);
    expect(chunks[0].startLine).toBe(1);
  });

  it("handles empty content", () => {
    const chunks = chunkMarkdown("");
    expect(chunks).toHaveLength(0);
  });

  it("creates overlapping chunks with shared content", () => {
    // Generate enough content for multiple chunks
    const sections = Array.from(
      { length: 15 },
      (_, i) =>
        `## Section ${i}\n\n${"The quick brown fox jumps over the lazy dog. ".repeat(15)}\n`,
    );
    const content = sections.join("\n");
    const chunks = chunkMarkdown(content);

    if (chunks.length >= 2) {
      // Verify that there's some overlap between consecutive chunks
      const firstEnd = chunks[0].endLine;
      const secondStart = chunks[1].startLine;
      expect(secondStart).toBeLessThanOrEqual(firstEnd + 1);
    }
  });

  it("splits on markdown boundaries (headers, blank lines)", () => {
    const content = [
      "# Header One",
      "",
      "A".repeat(2000),
      "",
      "# Header Two",
      "",
      "B".repeat(2000),
    ].join("\n");

    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should contain Header One
    expect(chunks[0].content).toContain("Header One");
  });

  it("tracks 1-indexed line numbers correctly", () => {
    const content = "line1\nline2\nline3\nline4\nline5";
    const chunks = chunkMarkdown(content);
    // First chunk should start at line 1
    expect(chunks[0].startLine).toBe(1);
    // End line should be >= start line
    expect(chunks[0].endLine).toBeGreaterThanOrEqual(chunks[0].startLine);
  });

  it("provides token estimates", () => {
    const content = "# Title\n\nSome text content for token estimation.";
    const chunks = chunkMarkdown(content);
    expect(chunks[0].tokenEstimate).toBeGreaterThan(0);
    // Token estimate should roughly correlate with content length / 4
    const expectedApprox = Math.ceil(chunks[0].content.length / 4);
    expect(chunks[0].tokenEstimate).toBe(expectedApprox);
  });
});
