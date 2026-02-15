import type { CronService } from "../../cron/service.js";
import type { MemorySearchManager } from "../../memory/search-manager.js";
import type { AgentToolDefinition } from "../../providers/types.js";
import type { ContainerManager } from "../../sandbox/container-manager.js";
import type { ChannelPlugin } from "../../types/channels.js";
import type { JinxConfig } from "../../types/config.js";
import type { SessionStore } from "../../types/sessions.js";
import { createLogger } from "../../infra/logger.js";
import { createSessionEntry } from "../../sessions/store.js";
import { resolveTranscriptPath } from "../../sessions/transcript.js";
import { runAgent } from "../runner.js";
import { completeSubagent, registerSubagent, removeSubagent } from "../subagent-registry.js";

const logger = createLogger("spawn");

export interface SpawnToolContext {
  parentSessionKey: string;
  config: JinxConfig;
  sessions: SessionStore;
  searchManager?: MemorySearchManager;
  cronService?: CronService;
  channels?: Map<string, ChannelPlugin>;
  containerManager?: ContainerManager;
}

export function getSpawnToolDefinitions(ctx: SpawnToolContext): AgentToolDefinition[] {
  return [
    {
      name: "sessions_spawn",
      description:
        "Spawn an isolated subagent session to handle a task autonomously. The subagent gets its own session and transcript. Use this to delegate research, analysis, or multi-step tasks while continuing your own work. The subagent result is returned when complete.",
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "The task for the subagent to accomplish. Be specific and clear.",
          },
          cleanup: {
            type: "string",
            enum: ["keep", "delete"],
            description:
              'What to do with the subagent session after completion. "keep" preserves the transcript; "delete" removes it. Default: "delete".',
          },
        },
        required: ["task"],
      },
      execute: async (input) => {
        const { task, cleanup } = input as {
          task: string;
          cleanup?: "keep" | "delete";
        };

        if (!task || !task.trim()) {
          return { error: "Task cannot be empty." };
        }

        const subagentSessionKey = `subagent:${crypto.randomUUID().slice(0, 8)}`;
        const transcriptPath = resolveTranscriptPath(subagentSessionKey);

        // Create subagent session
        const session = createSessionEntry({
          sessionKey: subagentSessionKey,
          agentId: "default",
          channel: "terminal",
          transcriptPath,
          parentSessionKey: ctx.parentSessionKey,
        });
        ctx.sessions.set(subagentSessionKey, session);

        // Register in subagent tracker
        registerSubagent({
          subagentSessionKey,
          parentSessionKey: ctx.parentSessionKey,
          task,
          status: "running",
          createdAt: Date.now(),
        });

        logger.info(`Spawning subagent: ${subagentSessionKey} for parent=${ctx.parentSessionKey}`);

        try {
          const result = await runAgent({
            prompt: task,
            sessionKey: subagentSessionKey,
            sessionType: "subagent",
            tier: "subagent",
            transcriptPath,
            config: ctx.config,
            sessions: ctx.sessions,
            searchManager: ctx.searchManager,
            cronService: ctx.cronService,
            channels: ctx.channels,
            containerManager: ctx.containerManager,
          });

          completeSubagent(subagentSessionKey, result.text, "completed");

          // Cleanup if requested
          if (cleanup === "delete" || !cleanup) {
            ctx.sessions.delete(subagentSessionKey);
            removeSubagent(subagentSessionKey);
          }

          return {
            subagentSessionKey,
            status: "completed",
            result: result.text,
            usage: {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
            },
          };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          completeSubagent(subagentSessionKey, reason, "failed");

          // Cleanup on failure too
          if (cleanup === "delete" || !cleanup) {
            ctx.sessions.delete(subagentSessionKey);
            removeSubagent(subagentSessionKey);
          }

          return {
            subagentSessionKey,
            status: "failed",
            error: reason,
          };
        }
      },
    },
  ];
}
