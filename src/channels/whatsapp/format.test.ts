import { describe, expect, it } from "vitest";
import { markdownToWhatsApp } from "./format.js";

describe("markdownToWhatsApp", () => {
  it("converts bold **text** to WhatsApp bold *text*", () => {
    expect(markdownToWhatsApp("**hello**")).toBe("*hello*");
  });

  it("converts italic *text* to WhatsApp italic _text_", () => {
    expect(markdownToWhatsApp("*hello*")).toBe("_hello_");
  });

  it("converts inline code `x` to WhatsApp code ```x```", () => {
    expect(markdownToWhatsApp("`code`")).toBe("```code```");
  });

  it("converts strikethrough ~~text~~ to WhatsApp ~text~", () => {
    expect(markdownToWhatsApp("~~deleted~~")).toBe("~deleted~");
  });

  it("converts links [text](url) to text (url)", () => {
    expect(markdownToWhatsApp("[Go](https://go.dev)")).toBe("Go (https://go.dev)");
  });

  it("handles bold and italic in the same string", () => {
    const result = markdownToWhatsApp("**bold** and *italic*");
    expect(result).toBe("*bold* and _italic_");
  });

  it("preserves fenced code blocks without language tag", () => {
    const input = "```typescript\nconst x = 1;\n```";
    const result = markdownToWhatsApp(input);
    expect(result).toBe("```\nconst x = 1;\n```");
  });

  it("passes through plain text unchanged", () => {
    expect(markdownToWhatsApp("just normal text")).toBe("just normal text");
  });

  it("handles multiple formatting in one line", () => {
    const input = "Use `grep` to find **matches** in *files*";
    const result = markdownToWhatsApp(input);
    expect(result).toBe("Use ```grep``` to find *matches* in _files_");
  });
});
