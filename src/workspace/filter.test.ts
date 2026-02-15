import { describe, expect, it } from "vitest";
import type { WorkspaceFile } from "./loader.js";
import { filterFilesForSession } from "./filter.js";

const makeFile = (name: string): WorkspaceFile => ({
  name: name as WorkspaceFile["name"],
  path: `/workspace/${name}`,
  content: `# ${name}`,
  missing: false,
});

const allFiles = [
  makeFile("SOUL.md"),
  makeFile("AGENTS.md"),
  makeFile("IDENTITY.md"),
  makeFile("USER.md"),
  makeFile("TOOLS.md"),
  makeFile("HEARTBEAT.md"),
  makeFile("BOOTSTRAP.md"),
  makeFile("MEMORY.md"),
];

describe("filterFilesForSession", () => {
  it("returns all files for main session", () => {
    const result = filterFilesForSession(allFiles, "main");
    expect(result).toHaveLength(8);
  });

  it("returns minimal set for subagent (includes AGENTS.md for operational protocol)", () => {
    const result = filterFilesForSession(allFiles, "subagent");
    const names = result.map((f) => f.name);
    expect(names).toContain("SOUL.md");
    expect(names).toContain("AGENTS.md");
    expect(names).toContain("TOOLS.md");
    expect(names).toContain("MEMORY.md");
    expect(names).not.toContain("HEARTBEAT.md");
    expect(names).not.toContain("BOOTSTRAP.md");
  });

  it("excludes HEARTBEAT.md and BOOTSTRAP.md for group", () => {
    const result = filterFilesForSession(allFiles, "group");
    const names = result.map((f) => f.name);
    expect(names).not.toContain("HEARTBEAT.md");
    expect(names).not.toContain("BOOTSTRAP.md");
    expect(names).toContain("SOUL.md");
    expect(names).toContain("MEMORY.md");
  });

  it("includes MEMORY.md in main session (private context)", () => {
    const result = filterFilesForSession(allFiles, "main");
    const names = result.map((f) => f.name);
    expect(names).toContain("MEMORY.md");
  });

  it("includes MEMORY.md in group session per PRD audience table", () => {
    const result = filterFilesForSession(allFiles, "group");
    const names = result.map((f) => f.name);
    expect(names).toContain("MEMORY.md");
  });

  it("includes MEMORY.md in subagent session", () => {
    const result = filterFilesForSession(allFiles, "subagent");
    const names = result.map((f) => f.name);
    expect(names).toContain("MEMORY.md");
  });

  it("group includes USER.md and IDENTITY.md", () => {
    const result = filterFilesForSession(allFiles, "group");
    const names = result.map((f) => f.name);
    expect(names).toContain("USER.md");
    expect(names).toContain("IDENTITY.md");
  });

  it("subagent excludes IDENTITY.md and USER.md", () => {
    const result = filterFilesForSession(allFiles, "subagent");
    const names = result.map((f) => f.name);
    expect(names).not.toContain("IDENTITY.md");
    expect(names).not.toContain("USER.md");
  });
});
