import { describe, expect, it } from "vitest";
import type { MarkdownIR } from "./ir.js";
import { renderMarkdownWithMarkers } from "./render.js";

function render(ir: MarkdownIR): string {
  return renderMarkdownWithMarkers(ir, {
    styleMarkers: {
      bold: { open: "<b>", close: "</b>" },
      italic: { open: "<i>", close: "</i>" },
      strikethrough: { open: "<s>", close: "</s>" },
      code: { open: "<code>", close: "</code>" },
      code_block: { open: "<pre>", close: "</pre>" },
    },
    escapeText: (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  });
}

describe("renderMarkdownWithMarkers", () => {
  it("returns empty string for empty input", () => {
    expect(render({ text: "", styles: [], links: [] })).toBe("");
  });

  it("renders plain text with escaping", () => {
    expect(render({ text: "a < b", styles: [], links: [] })).toBe("a &lt; b");
  });

  it("renders a bold span", () => {
    const ir: MarkdownIR = {
      text: "hello world",
      styles: [{ start: 0, end: 5, style: "bold" }],
      links: [],
    };
    expect(render(ir)).toBe("<b>hello</b> world");
  });

  it("renders nested bold+italic", () => {
    const ir: MarkdownIR = {
      text: "hello",
      styles: [
        { start: 0, end: 5, style: "bold" },
        { start: 0, end: 5, style: "italic" },
      ],
      links: [],
    };
    const result = render(ir);
    expect(result).toContain("<b>");
    expect(result).toContain("<i>");
    expect(result).toContain("</i>");
    expect(result).toContain("</b>");
  });

  it("renders a link", () => {
    const ir: MarkdownIR = {
      text: "click here",
      styles: [],
      links: [{ start: 0, end: 10, href: "https://example.com" }],
    };
    const result = renderMarkdownWithMarkers(ir, {
      styleMarkers: {},
      escapeText: (t) => t,
      buildLink: (link) => ({
        start: link.start,
        end: link.end,
        open: `<a href="${link.href}">`,
        close: "</a>",
      }),
    });
    expect(result).toBe('<a href="https://example.com">click here</a>');
  });

  it("skips zero-length spans", () => {
    const ir: MarkdownIR = {
      text: "hello",
      styles: [{ start: 3, end: 3, style: "bold" }],
      links: [],
    };
    expect(render(ir)).toBe("hello");
  });
});
