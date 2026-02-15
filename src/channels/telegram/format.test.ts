import { describe, expect, it } from "vitest";
import { markdownToTelegramHtml, markdownToTelegramChunks } from "./format.js";

describe("markdownToTelegramHtml", () => {
  it("converts bold", () => {
    expect(markdownToTelegramHtml("**hello**")).toBe("<b>hello</b>");
  });

  it("converts italic", () => {
    expect(markdownToTelegramHtml("*hello*")).toBe("<i>hello</i>");
  });

  it("converts inline code", () => {
    expect(markdownToTelegramHtml("`foo()`")).toBe("<code>foo()</code>");
  });

  it("escapes HTML in code", () => {
    expect(markdownToTelegramHtml("`<div>`")).toBe("<code>&lt;div&gt;</code>");
  });

  it("converts fenced code blocks", () => {
    const input = "```js\nconst x = 1;\n```";
    const out = markdownToTelegramHtml(input);
    expect(out).toContain("<pre><code>");
    expect(out).toContain("const x = 1;");
    expect(out).toContain("</code></pre>");
  });

  it("converts links", () => {
    expect(markdownToTelegramHtml("[Go](https://go.dev)")).toBe('<a href="https://go.dev">Go</a>');
  });

  it("handles mixed formatting", () => {
    const input = "**bold** and *italic* and `code`";
    const out = markdownToTelegramHtml(input);
    expect(out).toContain("<b>bold</b>");
    expect(out).toContain("<i>italic</i>");
    expect(out).toContain("<code>code</code>");
  });

  it("converts strikethrough", () => {
    expect(markdownToTelegramHtml("~~hello~~")).toBe("<s>hello</s>");
  });

  it("converts blockquotes", () => {
    const out = markdownToTelegramHtml("> quoted text");
    expect(out).toContain("<blockquote>");
    expect(out).toContain("quoted text");
    expect(out).toContain("</blockquote>");
  });

  it("converts spoilers", () => {
    const out = markdownToTelegramHtml("||spoiler||");
    expect(out).toContain("<tg-spoiler>");
    expect(out).toContain("spoiler");
    expect(out).toContain("</tg-spoiler>");
  });

  // XSS prevention: markdown-it doesn't recognize javascript:/data:/vbscript:
  // as valid link schemes, so they never produce <a> tags.
  it("does not render javascript: scheme links (XSS prevention)", () => {
    const out = markdownToTelegramHtml("[click](javascript:alert)");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("href");
  });

  it("does not render data: scheme links (XSS prevention)", () => {
    const out = markdownToTelegramHtml("[click](data:text/html,<script>alert(1)</script>)");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("href");
  });

  it("does not render vbscript: scheme links (XSS prevention)", () => {
    const out = markdownToTelegramHtml("[click](vbscript:MsgBox)");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("href");
  });

  it("escapes HTML entities in link labels", () => {
    const out = markdownToTelegramHtml("[<script>](https://example.com)");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
  });

  it("allows https: scheme links", () => {
    expect(markdownToTelegramHtml("[Go](https://go.dev)")).toBe('<a href="https://go.dev">Go</a>');
  });

  it("allows tg: scheme links", () => {
    const out = markdownToTelegramHtml("[join](tg://resolve?domain=test)");
    expect(out).toContain('<a href="tg://resolve?domain=test">');
  });

  it("allows mailto: scheme links", () => {
    const out = markdownToTelegramHtml("[email](mailto:a@b.com)");
    expect(out).toContain('<a href="mailto:a@b.com">');
  });
});

describe("markdownToTelegramChunks", () => {
  it("returns single chunk for short text", () => {
    const chunks = markdownToTelegramChunks("**hello**", 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.html).toBe("<b>hello</b>");
    expect(chunks[0]!.text).toBe("hello");
  });

  it("splits long text into multiple chunks", () => {
    const md = "word ".repeat(100).trim();
    const chunks = markdownToTelegramChunks(md, 50);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("preserves formatting in chunks", () => {
    const md = "**bold** " + "filler ".repeat(50);
    const chunks = markdownToTelegramChunks(md, 60);
    expect(chunks[0]!.html).toContain("<b>bold</b>");
  });
});
