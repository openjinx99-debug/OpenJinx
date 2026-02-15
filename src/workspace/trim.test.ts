import { describe, expect, it } from "vitest";
import { trimFileContent, trimWorkspaceFiles } from "./trim.js";

describe("trimFileContent", () => {
  it("returns short content unchanged", () => {
    const content = "Hello world";
    expect(trimFileContent(content)).toBe(content);
  });

  it("trims long content with head/tail strategy", () => {
    const content = "x".repeat(25_000);
    const trimmed = trimFileContent(content, 20_000);
    expect(trimmed.length).toBeLessThanOrEqual(20_000);
    expect(trimmed).toContain("truncated");
  });

  it("preserves beginning and end of content", () => {
    const content = "START" + "x".repeat(25_000) + "END";
    const trimmed = trimFileContent(content, 1000);
    expect(trimmed.startsWith("START")).toBe(true);
    expect(trimmed.endsWith("END")).toBe(true);
  });
});

describe("trimWorkspaceFiles", () => {
  it("trims all files in the array", () => {
    const files = [
      { name: "A", content: "x".repeat(25_000) },
      { name: "B", content: "short" },
    ];
    const trimmed = trimWorkspaceFiles(files, 20_000);
    expect(trimmed[0].content.length).toBeLessThanOrEqual(20_000);
    expect(trimmed[1].content).toBe("short");
  });
});
