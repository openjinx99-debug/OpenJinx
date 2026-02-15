import { describe, expect, it } from "vitest";
import { hasActionableHeartbeatContent } from "./preflight.js";

describe("hasActionableHeartbeatContent", () => {
  it("returns false for empty string", () => {
    expect(hasActionableHeartbeatContent("")).toBe(false);
  });

  it("returns false for whitespace only", () => {
    expect(hasActionableHeartbeatContent("   \n\n  \t  ")).toBe(false);
  });

  it("returns false for headers only", () => {
    expect(hasActionableHeartbeatContent("# Heartbeat\n\n## Active Items")).toBe(false);
  });

  it("returns false for headers and comments only", () => {
    const content = `# Heartbeat

<!-- Add monitoring items below -->

## Active Items

<!-- Nothing here yet -->
`;
    expect(hasActionableHeartbeatContent(content)).toBe(false);
  });

  it("returns false for empty list items", () => {
    const content = `# Heartbeat

-
- [ ]
*
`;
    expect(hasActionableHeartbeatContent(content)).toBe(false);
  });

  it("returns true for real task items", () => {
    const content = `# Heartbeat

- Check weather forecast every morning
`;
    expect(hasActionableHeartbeatContent(content)).toBe(true);
  });

  it("returns true for checkbox items with text", () => {
    const content = `# Heartbeat

- [ ] Review PRs
- [x] Update memory
`;
    expect(hasActionableHeartbeatContent(content)).toBe(true);
  });

  it("returns true for mixed content with real items", () => {
    const content = `# Heartbeat

<!-- Monitoring -->

## Active Items

- Monitor build status on CI
`;
    expect(hasActionableHeartbeatContent(content)).toBe(true);
  });
});
