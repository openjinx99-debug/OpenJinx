import type { AgentToolDefinition } from "../../providers/types.js";
import type { SessionStore } from "../../types/sessions.js";
import { formatUserTime, resolveUserTimezone } from "../../infra/date-time.js";
import { formatDurationHuman } from "../../infra/format-time.js";
import { readMetrics, computeUsageSummary } from "../../infra/metrics.js";

export interface SessionToolContext {
  sessionKey: string;
  sessions: SessionStore;
  timezone?: string;
}

/**
 * Returns tool definitions for session-related introspection.
 * Currently provides `session_status` — a zero-argument tool that
 * returns the current time, session age, turn count, and token usage.
 */
export function getSessionToolDefinitions(ctx: SessionToolContext): AgentToolDefinition[] {
  return [
    {
      name: "session_status",
      description:
        "Get the current time, session age, turn count, and token usage. Call this when you need the exact current time or session statistics.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      execute: async () => {
        const now = new Date();
        const tz = resolveUserTimezone(ctx.timezone);
        const timeStr = formatUserTime(now, tz) ?? now.toISOString();

        const session = ctx.sessions.get(ctx.sessionKey);
        if (!session) {
          return `🕒 Time: ${timeStr} (${tz})\n📊 Session: not found`;
        }

        const ageMs = Date.now() - session.createdAt;
        const age = formatDurationHuman(ageMs);

        const lines = [
          `🕒 Time: ${timeStr} (${tz})`,
          `📊 Session: ${session.turnCount} turns, started ${age === "just now" ? "just now" : `${age} ago`}`,
          `💬 Tokens: ${session.totalInputTokens.toLocaleString()} in / ${session.totalOutputTokens.toLocaleString()} out`,
        ];

        // Add cache stats from metrics (last 1 hour for this session)
        try {
          const since = Date.now() - 60 * 60 * 1000;
          const metrics = await readMetrics(since);
          const sessionMetrics = metrics.filter((m) => m.sessionKey === ctx.sessionKey);
          if (sessionMetrics.length > 0) {
            const summary = computeUsageSummary(sessionMetrics);
            lines.push(
              `📦 Cache: ${summary.cacheHitRate.toFixed(0)}% hit rate (${summary.totalCacheReadTokens.toLocaleString()} read / ${summary.totalCacheCreationTokens.toLocaleString()} write)`,
            );
          }
        } catch {
          // Metrics unavailable — not critical
        }

        return lines.join("\n");
      },
    },
  ];
}
