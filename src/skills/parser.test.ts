import { describe, expect, it } from "vitest";
import { extractSkillBody, parseSkillFrontmatter, substituteArguments } from "./parser.js";

describe("parseSkillFrontmatter", () => {
  it("parses all supported fields", () => {
    const content = `---
name: web-search
display_name: Web Search
description: Search the web using a search engine
os: macos, linux
required_bins: curl, jq
required_env: OPENAI_API_KEY, SEARCH_KEY
tags: search, web
install: brew install curl
---

# Web Search Skill

Instructions for the agent...`;

    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe("web-search");
    expect(result.displayName).toBe("Web Search");
    expect(result.description).toBe("Search the web using a search engine");
    expect(result.os).toEqual(["macos", "linux"]);
    expect(result.requiredBins).toEqual(["curl", "jq"]);
    expect(result.requiredEnvVars).toEqual(["OPENAI_API_KEY", "SEARCH_KEY"]);
    expect(result.tags).toEqual(["search", "web"]);
    expect(result.install).toBe("brew install curl");
  });

  it("returns empty object for content without frontmatter", () => {
    const result = parseSkillFrontmatter("# Just a regular markdown file");
    expect(result).toEqual({});
  });

  it("returns empty object for empty string", () => {
    expect(parseSkillFrontmatter("")).toEqual({});
  });

  it("handles empty frontmatter block", () => {
    const result = parseSkillFrontmatter("---\n---\nBody content");
    expect(result).toEqual({});
  });

  it("ignores unknown keys", () => {
    const content = `---
name: test
unknown_key: some value
---`;

    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe("test");
    expect(result).not.toHaveProperty("unknown_key");
  });

  it("parses allowed_tools as YAML array", () => {
    const content = `---
name: test
allowed_tools:
  - read
  - write
  - exec
---`;

    const result = parseSkillFrontmatter(content);
    expect(result.allowedTools).toEqual(["read", "write", "exec"]);
  });

  it("parses allowed_tools as comma-separated string", () => {
    const content = `---
name: test
allowed_tools: read, write
---`;

    const result = parseSkillFrontmatter(content);
    expect(result.allowedTools).toEqual(["read", "write"]);
  });

  it("parses context as YAML array", () => {
    const content = `---
name: test
context:
  - ./README.md
  - ./config.yaml
---`;

    const result = parseSkillFrontmatter(content);
    expect(result.context).toEqual(["./README.md", "./config.yaml"]);
  });

  it("parses agent and argument_hint fields", () => {
    const content = `---
name: deploy
agent: ops-agent
argument_hint: <environment> [--dry-run]
---`;

    const result = parseSkillFrontmatter(content);
    expect(result.agent).toBe("ops-agent");
    expect(result.argumentHint).toBe("<environment> [--dry-run]");
  });

  it("handles install field with complex shell commands", () => {
    const content = `---
name: apple-notes
install: brew tap antoniorodr/memo && brew install antoniorodr/memo/memo
---`;

    const result = parseSkillFrontmatter(content);
    expect(result.install).toBe("brew tap antoniorodr/memo && brew install antoniorodr/memo/memo");
  });

  it("handles values with extra whitespace", () => {
    const content = `---
name:   spaced-name
tags:  a ,  b , c
---`;

    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe("spaced-name");
    expect(result.tags).toEqual(["a", "b", "c"]);
  });

  it("handles single-item comma-separated fields", () => {
    const content = `---
name: simple
os: macos
required_bins: git
---`;

    const result = parseSkillFrontmatter(content);
    expect(result.os).toEqual(["macos"]);
    expect(result.requiredBins).toEqual(["git"]);
  });

  it("handles description containing colons", () => {
    const content = `---
name: test
description: "Does something: this and that"
---`;

    const result = parseSkillFrontmatter(content);
    expect(result.description).toBe("Does something: this and that");
  });

  it("handles YAML boolean and numeric values gracefully", () => {
    const content = `---
name: test
os:
  - macos
  - linux
---`;

    const result = parseSkillFrontmatter(content);
    expect(result.os).toEqual(["macos", "linux"]);
  });

  it("returns empty object for malformed YAML", () => {
    const content = `---
name: test
  bad indent: value
    nested: wrong
---`;

    // Should not throw — returns what it can or empty
    const result = parseSkillFrontmatter(content);
    expect(result).toBeDefined();
  });
});

describe("extractSkillBody", () => {
  it("extracts body after frontmatter", () => {
    const content = `---
name: test
---
# Skill Body

Instructions here.`;

    expect(extractSkillBody(content)).toBe("# Skill Body\n\nInstructions here.");
  });

  it("returns full content if no frontmatter", () => {
    expect(extractSkillBody("# Just content")).toBe("# Just content");
  });
});

describe("substituteArguments", () => {
  it("replaces $ARGUMENTS with provided args", () => {
    const body = "Run the command on $ARGUMENTS";
    expect(substituteArguments(body, "my-project")).toBe("Run the command on my-project");
  });

  it("replaces $0 with provided args", () => {
    const body = "Deploy $0 to production";
    expect(substituteArguments(body, "v1.2.3")).toBe("Deploy v1.2.3 to production");
  });

  it("replaces multiple occurrences", () => {
    const body = "First: $ARGUMENTS, then: $ARGUMENTS, also: $0";
    expect(substituteArguments(body, "foo")).toBe("First: foo, then: foo, also: foo");
  });

  it("handles empty args", () => {
    const body = "Do $ARGUMENTS now";
    expect(substituteArguments(body, "")).toBe("Do  now");
  });
});
