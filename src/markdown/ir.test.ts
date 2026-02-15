import { describe, expect, it } from "vitest";
import { chunkMarkdownIR, markdownToIR } from "./ir.js";

describe("markdownToIR", () => {
  it("parses bold text", () => {
    const ir = markdownToIR("**hello**");
    expect(ir.text).toBe("hello");
    expect(ir.styles).toEqual([{ start: 0, end: 5, style: "bold" }]);
  });

  it("parses italic text", () => {
    const ir = markdownToIR("*hello*");
    expect(ir.text).toBe("hello");
    expect(ir.styles).toEqual([{ start: 0, end: 5, style: "italic" }]);
  });

  it("parses strikethrough", () => {
    const ir = markdownToIR("~~hello~~");
    expect(ir.text).toBe("hello");
    expect(ir.styles).toEqual([{ start: 0, end: 5, style: "strikethrough" }]);
  });

  it("parses inline code", () => {
    const ir = markdownToIR("`code`");
    expect(ir.text).toBe("code");
    expect(ir.styles).toEqual([{ start: 0, end: 4, style: "code" }]);
  });

  it("parses fenced code blocks", () => {
    const ir = markdownToIR("```\nconst x = 1;\n```");
    expect(ir.text).toContain("const x = 1;");
    expect(ir.styles.some((s) => s.style === "code_block")).toBe(true);
  });

  it("parses links", () => {
    const ir = markdownToIR("[Go](https://go.dev)");
    expect(ir.text).toBe("Go");
    expect(ir.links).toEqual([{ start: 0, end: 2, href: "https://go.dev" }]);
  });

  it("parses blockquotes", () => {
    const ir = markdownToIR("> quoted");
    expect(ir.text).toContain("quoted");
    expect(ir.styles.some((s) => s.style === "blockquote")).toBe(true);
  });

  it("parses bullet lists", () => {
    const ir = markdownToIR("- one\n- two");
    expect(ir.text).toContain("one");
    expect(ir.text).toContain("two");
    expect(ir.text).toContain("•");
  });

  it("parses ordered lists", () => {
    const ir = markdownToIR("1. first\n2. second");
    expect(ir.text).toContain("1.");
    expect(ir.text).toContain("2.");
  });

  it("handles empty input", () => {
    const ir = markdownToIR("");
    expect(ir.text).toBe("");
    expect(ir.styles).toEqual([]);
    expect(ir.links).toEqual([]);
  });

  it("parses spoilers when enabled", () => {
    const ir = markdownToIR("||spoiler||", { enableSpoilers: true });
    expect(ir.text).toBe("spoiler");
    expect(ir.styles.some((s) => s.style === "spoiler")).toBe(true);
  });

  it("ignores spoilers when disabled", () => {
    const ir = markdownToIR("||text||", { enableSpoilers: false });
    // Text includes the || markers as literal text
    expect(ir.styles.every((s) => s.style !== "spoiler")).toBe(true);
  });
});

describe("chunkMarkdownIR", () => {
  it("returns single chunk when within limit", () => {
    const ir = markdownToIR("short");
    const chunks = chunkMarkdownIR(ir, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe("short");
  });

  it("returns empty for empty IR", () => {
    const ir = { text: "", styles: [], links: [] };
    expect(chunkMarkdownIR(ir, 100)).toEqual([]);
  });

  it("splits long text into chunks", () => {
    const ir = markdownToIR("word ".repeat(100).trim());
    const chunks = chunkMarkdownIR(ir, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(50);
    }
  });

  it("preserves style spans in chunks", () => {
    const ir = markdownToIR("**bold text** and more words to make it longer");
    const chunks = chunkMarkdownIR(ir, 15);
    // First chunk should contain the bold span
    expect(chunks[0]!.styles.some((s) => s.style === "bold")).toBe(true);
  });
});
