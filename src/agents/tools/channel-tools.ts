import type { AgentToolDefinition } from "../../providers/types.js";
import type { SessionStore } from "../../types/sessions.js";

export interface ChannelToolDeps {
  sessions: SessionStore;
  send: (channel: string, to: string, text: string) => Promise<boolean>;
}

/**
 * Channel tool definitions.
 *
 * Returns tools only when deps are provided (i.e. channel tools are wired).
 * When deps are missing, returns [] to avoid advertising unusable tools
 * to the agent (which wastes context and produces confusing failures).
 *
 * Phase 4A will wire real deps through the dispatch pipeline.
 */
export function getChannelToolDefinitions(deps?: ChannelToolDeps): AgentToolDefinition[] {
  if (!deps) {
    return [];
  }

  return [
    {
      name: "message",
      description:
        "Send a message to a channel. Used for proactive outreach or multi-channel delivery.",
      inputSchema: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            enum: ["terminal", "telegram", "whatsapp"],
            description: "Target channel",
          },
          to: { type: "string", description: "Recipient identifier" },
          text: { type: "string", description: "Message text" },
          account_id: { type: "string", description: "Bot account to send from" },
        },
        required: ["channel", "to", "text"],
      },
      execute: async (input) => {
        const { channel, to, text } = input as { channel: string; to: string; text: string };
        const ok = await deps.send(channel, to, text);
        return { sent: ok };
      },
    },
    {
      name: "sessions_send",
      description: "Send a message to a specific session by session key.",
      inputSchema: {
        type: "object",
        properties: {
          session_key: { type: "string", description: "Target session key" },
          text: { type: "string", description: "Message text" },
        },
        required: ["session_key", "text"],
      },
      execute: async (input) => {
        const { session_key, text } = input as { session_key: string; text: string };
        const session = deps.sessions.get(session_key);
        if (!session) {
          return { sent: false, message: "Session not found" };
        }
        const to = session.groupId ?? session.peerId;
        if (!to) {
          return { sent: false, message: "No recipient in session" };
        }
        const ok = await deps.send(session.channel, to, text);
        return { sent: ok };
      },
    },
    {
      name: "sessions_list",
      description: "List active sessions with their metadata.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Filter by channel" },
          limit: { type: "number", description: "Max results (default: 20)" },
        },
      },
      execute: async (input) => {
        const { channel, limit } = (input ?? {}) as { channel?: string; limit?: number };
        const all = deps.sessions.list();
        const filtered = channel ? all.filter((s) => s.channel === channel) : all;
        const capped = filtered.slice(0, limit ?? 20);
        return {
          sessions: capped.map((s) => ({
            sessionKey: s.sessionKey,
            channel: s.channel,
            agentId: s.agentId,
            turnCount: s.turnCount,
            lastActiveAt: s.lastActiveAt,
          })),
        };
      },
    },
  ];
}
