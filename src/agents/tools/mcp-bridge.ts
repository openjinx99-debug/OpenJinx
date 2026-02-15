import type { AgentToolDefinition } from "../../providers/types.js";

/**
 * MCP bridge for custom tool servers.
 * Will be wired to createSdkMcpServer() from the Claude Agent SDK.
 */

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Create tool definitions from an MCP server configuration.
 * Stub — will connect to actual MCP servers in integration phase.
 */
export function createMcpToolDefinitions(_config: McpServerConfig): AgentToolDefinition[] {
  // In production, this will:
  // 1. Start the MCP server subprocess
  // 2. Discover available tools via the MCP protocol
  // 3. Return AgentToolDefinition wrappers that proxy to the MCP server
  return [];
}

/**
 * Aggregate tool definitions from all configured tool sources.
 */
export function aggregateTools(
  coreDefs: AgentToolDefinition[],
  memoryDefs: AgentToolDefinition[],
  channelDefs: AgentToolDefinition[],
  cronDefs: AgentToolDefinition[],
  mcpDefs: AgentToolDefinition[],
  webDefs: AgentToolDefinition[] = [],
  sessionDefs: AgentToolDefinition[] = [],
  composioDefs: AgentToolDefinition[] = [],
): AgentToolDefinition[] {
  return [
    ...coreDefs,
    ...memoryDefs,
    ...channelDefs,
    ...cronDefs,
    ...mcpDefs,
    ...webDefs,
    ...sessionDefs,
    ...composioDefs,
  ];
}
