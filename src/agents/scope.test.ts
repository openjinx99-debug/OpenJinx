import { describe, expect, it } from "vitest";
import type { JinxConfig } from "../types/config.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { resolveAgent, resolveModel } from "./scope.js";

const config: JinxConfig = {
  ...DEFAULT_CONFIG,
  agents: {
    default: "main",
    list: [
      { id: "main", name: "Main", workspace: "~/.jinx/workspace" },
      { id: "research", name: "Research", workspace: "~/.jinx/research", model: "opus" },
    ],
  },
};

describe("resolveAgent", () => {
  it("resolves default agent for plain session key", () => {
    const agent = resolveAgent(config, "session-123");
    expect(agent.id).toBe("main");
  });

  it("resolves agent by prefix", () => {
    const agent = resolveAgent(config, "agent:research:session-123");
    expect(agent.id).toBe("research");
  });

  it("falls back to default for unknown agent prefix", () => {
    const agent = resolveAgent(config, "agent:unknown:session-123");
    expect(agent.id).toBe("main");
  });
});

describe("resolveModel", () => {
  it("uses config-level brain model", () => {
    expect(resolveModel(config, "brain")).toBe("opus");
  });

  it("uses agent-specific model override for brain tier", () => {
    expect(resolveModel(config, "brain", "sonnet")).toBe("sonnet");
  });

  it("uses config-level model for non-brain tiers regardless of agent", () => {
    expect(resolveModel(config, "subagent", "opus")).toBe("sonnet");
    expect(resolveModel(config, "light", "opus")).toBe("haiku");
  });

  it("resolves light tier to haiku for heartbeat-style tasks", () => {
    expect(resolveModel(config, "light")).toBe("haiku");
  });
});
