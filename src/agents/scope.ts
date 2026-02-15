import type { JinxConfig, ClaudeModelId, ClaudeModelTier, AgentConfig } from "../types/config.js";

/**
 * Resolve which agent should handle a given session key.
 */
export function resolveAgent(config: JinxConfig, sessionKey: string): AgentConfig {
  // Check for agent-prefixed session keys (e.g., "agent:custom:session-123")
  const agentPrefix = extractAgentId(sessionKey);
  if (agentPrefix) {
    const agent = config.agents.list.find((a) => a.id === agentPrefix);
    if (agent) {
      return agent;
    }
  }

  // Fall back to default agent
  const defaultId = config.agents.default;
  const defaultAgent = config.agents.list.find((a) => a.id === defaultId);
  if (!defaultAgent) {
    throw new Error(`Default agent "${defaultId}" not found in config`);
  }
  return defaultAgent;
}

/**
 * Resolve the model ID for a given task tier and agent config.
 */
export function resolveModel(
  config: JinxConfig,
  tier: ClaudeModelTier,
  agentModel?: ClaudeModelId,
): ClaudeModelId {
  // Agent-specific model override takes priority for "brain" tier
  if (tier === "brain" && agentModel) {
    return agentModel;
  }

  // Use config-level tier mapping
  return config.llm[tier];
}

/**
 * Extract agent ID from a session key if it follows the "agent:ID:rest" pattern.
 */
function extractAgentId(sessionKey: string): string | undefined {
  if (sessionKey.startsWith("agent:")) {
    const parts = sessionKey.split(":");
    if (parts.length >= 3) {
      return parts[1];
    }
  }
  return undefined;
}
