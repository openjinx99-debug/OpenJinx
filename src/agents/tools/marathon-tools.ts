import type { AgentToolDefinition } from "../../providers/types.js";
import type { ChunkDefinition } from "../../types/marathon.js";
import { createLogger } from "../../infra/logger.js";
import { logProductTelemetry } from "../../infra/product-telemetry.js";
import { patchCheckpoint, readCheckpoint } from "../../pipeline/checkpoint.js";
import {
  ACCEPTANCE_FORMAT_HINT,
  validateChunkDefinition,
} from "../../pipeline/marathon-plan-validation.js";

const logger = createLogger("marathon-tools");

type PlanUpdateValidationResult =
  | { ok: true; chunks: ChunkDefinition[] }
  | { ok: false; errors: string[] };

function validatePlanUpdateInput(input: unknown): PlanUpdateValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["Input must be an object with a chunks array."] };
  }

  const rawChunks = (input as { chunks?: unknown }).chunks;
  if (!Array.isArray(rawChunks)) {
    return { ok: false, errors: ["`chunks` must be an array."] };
  }
  if (rawChunks.length === 0) {
    return { ok: false, errors: ["`chunks` must contain at least one future chunk."] };
  }

  const errors: string[] = [];
  const chunks: ChunkDefinition[] = [];

  for (let i = 0; i < rawChunks.length; i++) {
    const validation = validateChunkDefinition(rawChunks[i], i, {
      minAcceptanceCriteria: 2,
      maxAcceptanceCriteria: 5,
      requireMachineVerifiableCriteria: true,
    });
    if (validation.errors.length > 0 || !validation.chunk) {
      errors.push(...validation.errors);
      continue;
    }
    chunks.push(validation.chunk);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, chunks };
}

export interface MarathonToolContext {
  /** The marathon task ID this session is executing. */
  taskId: string;
}

/**
 * Tool definitions available to the agent during marathon chunk execution.
 * Provides read access to checkpoint state and the ability to modify remaining chunks.
 */
export function getMarathonToolDefinitions(ctx: MarathonToolContext): AgentToolDefinition[] {
  return [
    {
      name: "marathon_status",
      description:
        "Read the current marathon checkpoint status, including progress, completed chunks, and the remaining plan.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute() {
        const checkpoint = await readCheckpoint(ctx.taskId);
        if (!checkpoint) {
          return { error: `Marathon task not found: ${ctx.taskId}` };
        }
        return {
          taskId: checkpoint.taskId,
          status: checkpoint.status,
          progress: `${checkpoint.currentChunkIndex}/${checkpoint.plan.chunks.length}`,
          goal: checkpoint.plan.goal,
          currentChunk: checkpoint.plan.chunks[checkpoint.currentChunkIndex]?.name ?? "none",
          completedChunks: checkpoint.completedChunks.map((c) => ({
            name: c.chunkName,
            status: c.status,
            filesWritten: c.filesWritten,
          })),
          remainingChunks: checkpoint.plan.chunks
            .slice(checkpoint.currentChunkIndex + 1)
            .map((c) => c.name),
        };
      },
    },
    {
      name: "marathon_plan_update",
      description:
        "Modify the remaining chunks in the marathon plan. Can add, remove, or reorder FUTURE chunks only (already-completed chunks cannot be changed). Use this to adapt the plan based on what you've learned during execution.",
      inputSchema: {
        type: "object",
        properties: {
          chunks: {
            type: "array",
            description: "New list of remaining chunks (replaces all future chunks).",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                prompt: { type: "string" },
                estimatedMinutes: { type: "number" },
                acceptanceCriteria: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Machine-verifiable criteria. Use one of: file_exists:, command_succeeds:, file_contains:, tests_pass",
                },
              },
              required: ["name", "prompt", "estimatedMinutes", "acceptanceCriteria"],
            },
          },
        },
        required: ["chunks"],
      },
      async execute(input: unknown) {
        const checkpoint = await readCheckpoint(ctx.taskId);
        if (!checkpoint) {
          return { error: `Marathon task not found: ${ctx.taskId}` };
        }

        const validation = validatePlanUpdateInput(input);
        if (!validation.ok) {
          logger.warn(
            `Marathon plan update rejected: task=${ctx.taskId}, errors=${validation.errors.join(" | ")}`,
          );
          logProductTelemetry({
            area: "marathon",
            event: "marathon_plan_update_rejected",
            taskId: ctx.taskId,
            errorCount: validation.errors.length,
            errors: validation.errors.slice(0, 5),
          });
          return {
            success: false,
            error:
              "Plan update rejected: invalid chunk schema or acceptance criteria. Existing plan preserved.",
            details: validation.errors,
            hint: ACCEPTANCE_FORMAT_HINT,
            suggestedChunkTemplate: {
              name: "meaningful-chunk-name",
              prompt: "Describe concrete work to perform in this chunk",
              estimatedMinutes: 10,
              acceptanceCriteria: [
                "file_exists: src/index.ts",
                "command_succeeds: cd /workspace && npm test",
              ],
            },
            currentChunk:
              checkpoint.plan.chunks[checkpoint.currentChunkIndex]?.name ??
              `index:${checkpoint.currentChunkIndex}`,
            remainingChunks: checkpoint.plan.chunks
              .slice(checkpoint.currentChunkIndex + 1)
              .map((c) => c.name),
          };
        }

        const { chunks } = validation;

        // Replace only future chunks (after currentChunkIndex + 1)
        const preservedChunks = checkpoint.plan.chunks.slice(0, checkpoint.currentChunkIndex + 1);
        const nextPlan = {
          ...checkpoint.plan,
          chunks: [...preservedChunks, ...chunks],
        };
        await patchCheckpoint(checkpoint.taskId, { plan: nextPlan });

        logger.info(
          `Marathon plan updated: task=${ctx.taskId}, new total chunks=${nextPlan.chunks.length}`,
        );
        logProductTelemetry({
          area: "marathon",
          event: "marathon_plan_updated",
          taskId: ctx.taskId,
          totalChunks: nextPlan.chunks.length,
          replacedFutureChunkCount: chunks.length,
        });

        return {
          success: true,
          totalChunks: nextPlan.chunks.length,
          remainingChunks: chunks.map((c) => c.name),
        };
      },
    },
  ];
}
