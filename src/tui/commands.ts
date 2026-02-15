import type { ChannelPlugin } from "../types/channels.js";
import type { JinxConfig } from "../types/config.js";
import type { SessionStore } from "../types/sessions.js";
import { readMetrics, computeUsageSummary } from "../infra/metrics.js";

export interface TuiCommand {
  name: string;
  description: string;
  handler: (args: string) => Promise<string | void>;
}

export interface TuiContext {
  config: JinxConfig;
  sessions: SessionStore;
  channels: Map<string, ChannelPlugin>;
  searchManager?: { getStatus(): { totalFiles: number; totalChunks: number } };
}

function relativeTime(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Built-in TUI slash commands. */
export function getBuiltinCommands(ctx?: TuiContext): TuiCommand[] {
  return [
    {
      name: "status",
      description: "Show gateway and channel status",
      handler: async () => {
        if (!ctx) {
          return "Status: not available (no runtime context)";
        }

        const lines = ["Status"];

        // Gateway
        lines.push(`  Gateway: ${ctx.config.gateway.host}:${ctx.config.gateway.port}`);

        // Channels
        const channelNames: string[] = [];
        for (const [, ch] of ctx.channels) {
          const status = ch.isReady() ? "ready" : "not ready";
          channelNames.push(`${ch.name} (${status})`);
        }
        lines.push(`  Channels: ${channelNames.length > 0 ? channelNames.join(", ") : "none"}`);

        // Memory
        if (ctx.searchManager) {
          const s = ctx.searchManager.getStatus();
          lines.push(`  Memory: ${s.totalFiles} files, ${s.totalChunks} chunks`);
        } else {
          lines.push("  Memory: disabled");
        }

        // Sessions
        const sessions = ctx.sessions.list();
        const userSessions = sessions.filter(
          (s) => !s.sessionKey.startsWith("heartbeat:") && !s.sessionKey.startsWith("cron:"),
        );
        lines.push(`  Sessions: ${userSessions.length} active`);

        return lines.join("\n");
      },
    },
    {
      name: "model",
      description: "Show current model configuration",
      handler: async () => {
        if (!ctx) {
          return "Model: not available (no runtime context)";
        }

        return `Models: Brain: ${ctx.config.llm.brain} | Subagent: ${ctx.config.llm.subagent} | Light: ${ctx.config.llm.light}`;
      },
    },
    {
      name: "agent",
      description: "Show current agent configuration",
      handler: async () => {
        if (!ctx) {
          return "Agent: not available (no runtime context)";
        }

        const lines = [`Default agent: ${ctx.config.agents.default}`];
        for (const agent of ctx.config.agents.list) {
          const isDefault = agent.id === ctx.config.agents.default ? " (default)" : "";
          lines.push(`  ${agent.id} — ${agent.name}${isDefault}`);
        }
        return lines.join("\n");
      },
    },
    {
      name: "sessions",
      description: "List active sessions",
      handler: async () => {
        if (!ctx) {
          return "Sessions: not available (no runtime context)";
        }

        const sessions = ctx.sessions.list();
        const userSessions = sessions.filter(
          (s) => !s.sessionKey.startsWith("heartbeat:") && !s.sessionKey.startsWith("cron:"),
        );

        if (userSessions.length === 0) {
          return "No active sessions.";
        }

        const lines = ["Sessions"];
        for (const s of userSessions) {
          const ago = relativeTime(s.lastActiveAt);
          lines.push(`  ${s.sessionKey} [${s.channel}] — ${s.turnCount} turns, ${ago}`);
        }
        return lines.join("\n");
      },
    },
    {
      name: "usage",
      description: "Show token usage and cache stats (last 24h)",
      handler: async () => {
        const since = Date.now() - 24 * 60 * 60 * 1000;
        const metrics = await readMetrics(since);
        if (metrics.length === 0) {
          return "No usage data in the last 24 hours.";
        }
        const s = computeUsageSummary(metrics);
        const lines = [
          "Token Usage (last 24h)",
          `  Turns: ${s.totalTurns} (chat: ${s.turnsByType.chat}, heartbeat: ${s.turnsByType.heartbeat}, cron: ${s.turnsByType.cron})`,
          `  Input:  ${s.totalInputTokens.toLocaleString()} tokens`,
          `  Output: ${s.totalOutputTokens.toLocaleString()} tokens`,
          `  Cache write: ${s.totalCacheCreationTokens.toLocaleString()} tokens`,
          `  Cache read:  ${s.totalCacheReadTokens.toLocaleString()} tokens`,
          `  Cache hit rate: ${s.cacheHitRate.toFixed(1)}%`,
        ];
        return lines.join("\n");
      },
    },
    {
      name: "help",
      description: "Show available commands",
      handler: async () => {
        const cmds = getBuiltinCommands(ctx);
        return cmds.map((c) => `  /${c.name} — ${c.description}`).join("\n");
      },
    },
    {
      name: "quit",
      description: "Exit Jinx",
      handler: async () => {
        process.exit(0);
      },
    },
  ];
}

/**
 * Parse and execute a TUI slash command.
 * Returns the command output or undefined if not a command.
 */
export async function executeTuiCommand(
  input: string,
  ctx?: TuiContext,
): Promise<{ handled: boolean; output?: string }> {
  if (!input.startsWith("/")) {
    return { handled: false };
  }

  const spaceIdx = input.indexOf(" ");
  const name = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx);
  const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();

  const commands = getBuiltinCommands(ctx);
  const cmd = commands.find((c) => c.name === name);

  if (!cmd) {
    return { handled: false };
  }

  const output = await cmd.handler(args);
  return { handled: true, output: output ?? undefined };
}
