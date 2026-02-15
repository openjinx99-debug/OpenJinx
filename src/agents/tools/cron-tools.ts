import type { CronService } from "../../cron/service.js";
import type { AgentToolDefinition } from "../../providers/types.js";
import type { CronSchedule, CronTarget } from "../../types/cron.js";
import type { SessionStore } from "../../types/sessions.js";
import { createLogger } from "../../infra/logger.js";
import { detectInjectionPatterns } from "../../infra/security.js";

const logger = createLogger("cron-tools");

export interface CronToolContext {
  service: CronService;
  sessionKey?: string;
  sessions?: SessionStore;
  channel?: string;
}

interface CronToolInput {
  action: "create" | "update" | "delete" | "list";
  id?: string;
  name?: string;
  schedule?: {
    type: "at" | "every" | "cron";
    timestamp?: number;
    interval_ms?: number;
    expression?: string;
    timezone?: string;
  };
  prompt?: string;
  isolated?: boolean;
  agent_id?: string;
}

function buildSchedule(input: CronToolInput["schedule"]): CronSchedule {
  if (!input) {
    throw new Error("schedule is required for create");
  }
  switch (input.type) {
    case "at":
      if (!input.timestamp) {
        throw new Error("timestamp is required for 'at' schedule");
      }
      return { type: "at", timestamp: input.timestamp };
    case "every":
      if (!input.interval_ms) {
        throw new Error("interval_ms is required for 'every' schedule");
      }
      return { type: "every", intervalMs: input.interval_ms };
    case "cron":
      if (!input.expression) {
        throw new Error("expression is required for 'cron' schedule");
      }
      return { type: "cron", expression: input.expression, timezone: input.timezone };
    default:
      throw new Error(`Unknown schedule type: ${input.type}`);
  }
}

/**
 * Resolve the delivery target from the current session context.
 * Captures the originating channel so cron results are sent back to the right place.
 */
function resolveDeliverTo(ctx: CronToolContext): CronTarget["deliverTo"] {
  if (!ctx.sessionKey || !ctx.sessions) {
    return undefined;
  }
  const session = ctx.sessions.get(ctx.sessionKey);
  if (!session?.channel) {
    return undefined;
  }
  const to = session.groupId ?? session.peerId;
  if (!to) {
    return undefined;
  }
  return { channel: session.channel, to };
}

/**
 * Cron tool definitions. When a CronService/context is provided, tools are fully functional.
 * Without a service, returns a stub that reports the feature is unavailable.
 */
export function getCronToolDefinitions(
  serviceOrCtx?: CronService | CronToolContext,
): AgentToolDefinition[] {
  // Normalize: accept either a bare CronService or a full context object
  const ctx: CronToolContext | undefined =
    serviceOrCtx && "service" in serviceOrCtx
      ? serviceOrCtx
      : serviceOrCtx
        ? { service: serviceOrCtx }
        : undefined;
  const service = ctx?.service;
  return [
    {
      name: "cron",
      description:
        "Create, update, or delete scheduled jobs. Jobs can run on an interval, at a specific time, or on a cron expression.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create", "update", "delete", "list"],
            description: "Action to perform",
          },
          id: { type: "string", description: "Job ID (for update/delete)" },
          name: { type: "string", description: "Human-readable job name" },
          schedule: {
            type: "object",
            description: "Schedule definition",
            properties: {
              type: { type: "string", enum: ["at", "every", "cron"] },
              timestamp: { type: "number", description: "Unix timestamp for 'at' type" },
              interval_ms: { type: "number", description: "Interval in ms for 'every' type" },
              expression: { type: "string", description: "Cron expression for 'cron' type" },
              timezone: { type: "string", description: "IANA timezone" },
            },
          },
          prompt: { type: "string", description: "Prompt to execute when job fires" },
          isolated: {
            type: "boolean",
            description: "Run in isolated session (vs. heartbeat). Default: true",
          },
          agent_id: { type: "string", description: "Target agent ID (defaults to default agent)" },
        },
        required: ["action"],
      },
      execute: async (input) => {
        if (!service) {
          return { success: false, message: "Cron service not available" };
        }

        const params = input as CronToolInput;

        switch (params.action) {
          case "list": {
            const jobs = service.list();
            return {
              success: true,
              jobs: jobs.map((j) => ({
                id: j.id,
                name: j.name,
                enabled: j.enabled,
                schedule: j.schedule,
                nextRunAt: j.nextRunAt,
                lastRunAt: j.lastRunAt,
                failCount: j.failCount,
              })),
            };
          }

          case "create": {
            if (!params.name) {
              return { success: false, message: "name is required" };
            }
            if (!params.prompt) {
              return { success: false, message: "prompt is required" };
            }

            // Audit cron prompt for injection patterns (log-only)
            const injectionPatterns = detectInjectionPatterns(params.prompt);
            if (injectionPatterns.length > 0) {
              logger.warn(
                `Injection patterns in cron prompt "${params.name}": ${injectionPatterns.join(", ")}`,
              );
            }

            try {
              const schedule = buildSchedule(params.schedule);

              // Reject one-shot timestamps that are in the past
              if (schedule.type === "at" && schedule.timestamp < Date.now() - 5_000) {
                return {
                  success: false,
                  message: `Timestamp ${schedule.timestamp} is in the past. Use a future Unix timestamp (ms). Current time: ${Date.now()}`,
                };
              }

              const job = service.add({
                name: params.name,
                schedule,
                payload: {
                  prompt: params.prompt,
                  isolated: params.isolated ?? true,
                },
                target: {
                  agentId: params.agent_id ?? "default",
                  deliverTo: ctx ? resolveDeliverTo(ctx) : undefined,
                },
              });
              return {
                success: true,
                job: { id: job.id, name: job.name, nextRunAt: job.nextRunAt },
              };
            } catch (err) {
              return {
                success: false,
                message: err instanceof Error ? err.message : String(err),
              };
            }
          }

          case "delete": {
            if (!params.id) {
              return { success: false, message: "id is required for delete" };
            }
            const removed = service.remove(params.id);
            return { success: removed, message: removed ? "Job deleted" : "Job not found" };
          }

          case "update": {
            if (!params.id) {
              return { success: false, message: "id is required for update" };
            }
            const existing = service.get(params.id);
            if (!existing) {
              return { success: false, message: "Job not found" };
            }

            const patch: Record<string, unknown> = {};
            if (params.name) {
              patch.name = params.name;
            }
            if (params.schedule) {
              patch.schedule = buildSchedule(params.schedule);
            }
            service.update(params.id, patch);
            return { success: true, message: "Job updated" };
          }

          default:
            return { success: false, message: `Unknown action: ${params.action}` };
        }
      },
    },
  ];
}
