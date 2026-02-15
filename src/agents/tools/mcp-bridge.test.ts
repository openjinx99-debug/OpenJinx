import { describe, it, expect } from "vitest";
import type { AgentToolDefinition } from "../../providers/types.js";
import { aggregateTools } from "./mcp-bridge.js";

function makeTool(name: string): AgentToolDefinition {
  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema: { type: "object", properties: {} },
    execute: async () => ({}),
  };
}

describe("aggregateTools", () => {
  it("concatenates tools from all sources in order", () => {
    const core = [makeTool("read_file"), makeTool("write_file")];
    const memory = [makeTool("memory_search")];
    const channel = [makeTool("message")];
    const cron = [makeTool("cron")];
    const mcp = [makeTool("custom_mcp")];
    const web = [makeTool("web_search")];
    const session = [makeTool("session_status")];

    const composio = [makeTool("composio_search")];

    const result = aggregateTools(core, memory, channel, cron, mcp, web, session, composio);
    const names = result.map((t) => t.name);

    expect(names).toEqual([
      "read_file",
      "write_file",
      "memory_search",
      "message",
      "cron",
      "custom_mcp",
      "web_search",
      "session_status",
      "composio_search",
    ]);
  });

  it("handles empty arrays", () => {
    const result = aggregateTools([], [], [], [], []);
    expect(result).toEqual([]);
  });

  it("defaults web, session, and composio to empty when omitted", () => {
    const core = [makeTool("read_file")];
    const result = aggregateTools(core, [], [], [], []);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("read_file");
  });

  it("includes composio tools when provided", () => {
    const core = [makeTool("read_file")];
    const composio = [makeTool("composio_search"), makeTool("composio_execute")];
    const result = aggregateTools(core, [], [], [], [], [], [], composio);
    const names = result.map((t) => t.name);
    expect(names).toEqual(["read_file", "composio_search", "composio_execute"]);
  });

  it("preserves all tool properties", () => {
    const tool: AgentToolDefinition = {
      name: "test_tool",
      description: "A test tool",
      inputSchema: {
        type: "object",
        properties: { input: { type: "string" } },
        required: ["input"],
      },
      execute: async () => ({ result: "ok" }),
    };

    const result = aggregateTools([tool], [], [], [], []);
    expect(result[0]).toBe(tool); // Same reference, not cloned
  });
});
