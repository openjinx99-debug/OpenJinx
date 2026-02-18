import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CronService } from "../cron/service.js";
import type { MemorySearchManager } from "../memory/search-manager.js";
import type { AgentToolDefinition } from "../providers/types.js";
import type { ContainerManager } from "../sandbox/container-manager.js";
import type { ChannelPlugin } from "../types/channels.js";
import type { JinxConfig } from "../types/config.js";
import type { DeliveryTarget, InputFileInfo, ChunkDefinition } from "../types/marathon.js";
import type { ChunkResult, MarathonCheckpoint } from "../types/marathon.js";
import type { MediaAttachment } from "../types/messages.js";
import type { SessionStore } from "../types/sessions.js";
import { runAgent } from "../agents/runner.js";
import { getCoreToolDefinitions } from "../agents/tools/core-tools.js";
import { getExecToolDefinitions } from "../agents/tools/exec-tools.js";
import { getMarathonToolDefinitions } from "../agents/tools/marathon-tools.js";
import { getWebFetchToolDefinitions } from "../agents/tools/web-fetch-tools.js";
import { getWebSearchToolDefinitions } from "../agents/tools/web-search-tools.js";
import { createLogger } from "../infra/logger.js";
import { logProductTelemetry } from "../infra/product-telemetry.js";
import { SECURE_DIR_MODE } from "../infra/security.js";
import { withTimeout } from "../infra/timeout.js";
import { createSessionEntry } from "../sessions/store.js";
import { resolveTranscriptPath } from "../sessions/transcript.js";
import {
  createCheckpoint,
  readCheckpoint,
  advanceCheckpoint,
  failChunk,
  cancelCheckpoint,
  pauseCheckpoint,
  updateCheckpointStatus,
  patchCheckpoint,
  resetCurrentChunkRetries,
  listCheckpoints,
  resolveMarathonWorkspace,
} from "./checkpoint.js";
import { packageDeliverables } from "./marathon-artifacts.js";
import {
  buildWorkspaceSnapshot,
  listFilesRecursive,
  writeProgressFile,
} from "./marathon-context.js";
import { buildControlPolicy } from "./marathon-control.js";
import { deliverMarathonPayload, sendMarathonProgressUpdate } from "./marathon-delivery.js";
import {
  buildPlanningPrompt,
  buildPlanningRepairPrompt,
  buildChunkPrompt,
  buildCriteriaRetryPrompt,
  parsePlanFromResult,
  formatFileSize,
} from "./marathon-prompts.js";
import { runTestFixLoop, verifyAcceptanceCriteria } from "./marathon-test-loop.js";
import { emitStreamEvent } from "./streaming.js";

const logger = createLogger("marathon");

/** Per-chunk timeout — 1 hour for large autonomous tasks. */
const CHUNK_TIMEOUT_MS = 60 * 60_000;

/** Planning turn timeout — 5 min (planning is lighter than execution). */
const PLANNING_TIMEOUT_MS = 15 * 60_000;

/** Track active marathon executor loops. */
const activeExecutors = new Map<string, { abortController: AbortController }>();
/** Track marathons currently in planning (reserved concurrency slots). */
const planningExecutors = new Set<string>();

export interface MarathonDeps {
  config: JinxConfig;
  sessions: SessionStore;
  cronService?: CronService;
  channels?: Map<string, ChannelPlugin>;
  containerManager?: ContainerManager;
  searchManager?: MemorySearchManager;
}

export interface LaunchMarathonParams {
  /** The enveloped prompt from the user. */
  prompt: string;
  /** Session key of the originating conversation. */
  originSessionKey: string;
  /** Where to deliver progress and results. */
  deliveryTarget: DeliveryTarget;
  /** Channel the message came from. */
  channel: string;
  /** Sender display name. */
  senderName: string;
  /** Sender ID (used for group authorization). */
  senderId?: string;
  /** Group ID when launched from a group session. */
  groupId?: string;
  /** Media attachments from the inbound message. */
  media?: MediaAttachment[];
}

/** Check how many marathons are currently executing. */
function activeMarathonCount(): number {
  return activeExecutors.size + planningExecutors.size;
}

function assertValidChunkDefinition(
  chunk: ChunkDefinition | undefined,
  taskId: string,
  chunkIndex: number,
): asserts chunk is ChunkDefinition {
  if (!chunk) {
    throw new Error(`Marathon ${taskId} has no chunk at index ${chunkIndex}`);
  }
  if (!Array.isArray(chunk.acceptanceCriteria)) {
    throw new Error(
      `Marathon ${taskId} plan invalid at chunk "${chunk.name}": acceptanceCriteria must be an array`,
    );
  }
}

/**
 * Launch a marathon task. Fire-and-forget — sends ack, then runs the executor loop.
 */
export function launchMarathon(params: LaunchMarathonParams, deps: MarathonDeps): void {
  const { config } = deps;

  // Enforce concurrency limit
  if (activeMarathonCount() >= config.marathon.maxConcurrent) {
    emitStreamEvent(params.originSessionKey, {
      type: "final",
      text: `Cannot start marathon: already at maximum concurrent tasks (${config.marathon.maxConcurrent}). Use /marathon status to check active tasks.`,
    });
    return;
  }

  const shortId = crypto.randomUUID().slice(0, 8);
  const taskId = `marathon-${shortId}`;
  const sessionKey = `marathon:${shortId}`;
  planningExecutors.add(taskId);

  emitMarathonTelemetry("marathon_launch_requested", {
    taskId,
    sessionKey,
    channel: params.deliveryTarget.channel,
    hasMedia: Boolean(params.media && params.media.length > 0),
  });

  // Emit ack on the origin session
  emitStreamEvent(params.originSessionKey, {
    type: "final",
    text: `Starting marathon task \`${taskId}\`. I'll plan the work, then execute it chunk by chunk. You'll receive progress updates and the final result when complete.`,
  });

  // Fire-and-forget
  executeMarathon(taskId, sessionKey, shortId, params, deps)
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Marathon failed (task=${taskId}): ${msg}`);
      emitMarathonTelemetry("marathon_launch_failed", {
        taskId,
        sessionKey,
        error: msg,
      });
    })
    .finally(() => {
      planningExecutors.delete(taskId);
    });
}

async function executeMarathon(
  taskId: string,
  sessionKey: string,
  shortId: string,
  params: LaunchMarathonParams,
  deps: MarathonDeps,
): Promise<void> {
  const { config, sessions, containerManager } = deps;
  const marathonConfig = config.marathon;
  emitMarathonTelemetry("marathon_execution_started", { taskId, sessionKey });

  // 1. Create workspace
  const workspaceDir = resolveMarathonWorkspace(shortId);
  await fs.mkdir(workspaceDir, { recursive: true, mode: SECURE_DIR_MODE });

  // 1b. Seed user-provided media files into the workspace
  const inputFiles = await seedWorkspaceMedia(workspaceDir, params.media);

  // 2. Create isolated session
  const transcriptPath = resolveTranscriptPath(sessionKey);
  const session = createSessionEntry({
    sessionKey,
    agentId: "default",
    channel: params.deliveryTarget.channel,
    transcriptPath,
    parentSessionKey: params.originSessionKey,
  });
  sessions.set(sessionKey, session);

  // 3. Create persistent container
  let containerId = "";
  if (containerManager) {
    const containerSession = await containerManager.getOrCreate(sessionKey, workspaceDir);
    containerManager.promote(sessionKey);
    containerId = containerSession.containerId;
  }

  // 4. Planning turn (brain tier) — no tools needed, planner just outputs JSON
  logger.info(`Marathon planning: task=${taskId}`);
  emitMarathonTelemetry("marathon_planning_started", { taskId, sessionKey });
  const planResult = await withTimeout(
    runAgent({
      prompt: buildPlanningPrompt(params.prompt, marathonConfig.maxChunks, inputFiles),
      sessionKey,
      sessionType: "main",
      tier: "brain",
      transcriptPath,
      config,
      sessions,
      tools: [],
      channel: params.channel,
      senderName: params.senderName,
      workspaceDir,
    }),
    PLANNING_TIMEOUT_MS,
    `Marathon planning timed out after ${PLANNING_TIMEOUT_MS / 1000}s`,
  );

  let plan = parsePlanFromResult(planResult.text);
  if (!plan || plan.chunks.length === 0) {
    emitMarathonTelemetry("marathon_plan_repair_started", {
      taskId,
      sessionKey,
      reason: "invalid-initial-plan",
    });

    try {
      const repairedResult = await withTimeout(
        runAgent({
          prompt: buildPlanningRepairPrompt(
            params.prompt,
            marathonConfig.maxChunks,
            planResult.text,
            inputFiles,
          ),
          sessionKey,
          sessionType: "main",
          tier: "brain",
          transcriptPath,
          config,
          sessions,
          tools: [],
          channel: params.channel,
          senderName: params.senderName,
          workspaceDir,
        }),
        PLANNING_TIMEOUT_MS,
        `Marathon plan repair timed out after ${PLANNING_TIMEOUT_MS / 1000}s`,
      );
      plan = parsePlanFromResult(repairedResult.text);
      if (plan && plan.chunks.length > 0) {
        emitMarathonTelemetry("marathon_plan_repair_succeeded", {
          taskId,
          sessionKey,
          chunkCount: plan.chunks.length,
        });
      } else {
        emitMarathonTelemetry("marathon_plan_repair_failed", {
          taskId,
          sessionKey,
          reason: "invalid-repair-plan",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitMarathonTelemetry("marathon_plan_repair_failed", {
        taskId,
        sessionKey,
        reason: "repair-turn-error",
        error: msg,
      });
      logger.warn(`Marathon plan repair failed for task=${taskId}: ${msg}`);
    }
  }

  if (!plan || plan.chunks.length === 0) {
    emitMarathonTelemetry("marathon_planning_failed", {
      taskId,
      sessionKey,
      reason: "empty_plan",
    });
    await deliverText(
      `Marathon planning failed: could not produce a valid chunk plan after automatic repair.\n\n` +
        `Try re-running with a more concrete request (deliverables, tech stack, constraints).\n\n` +
        `Raw planner response (truncated):\n\n${planResult.text.slice(0, 500)}`,
      params.deliveryTarget,
      deps,
      { taskId, reason: "planning-failed" },
    );
    return;
  }

  // Enforce maxChunks
  if (plan.chunks.length > marathonConfig.maxChunks) {
    plan.chunks = plan.chunks.slice(0, marathonConfig.maxChunks);
  }
  emitMarathonTelemetry("marathon_plan_ready", {
    taskId,
    sessionKey,
    chunkCount: plan.chunks.length,
  });

  // 5. Create checkpoint
  await createCheckpoint({
    taskId,
    sessionKey,
    containerId,
    plan,
    deliverTo: params.deliveryTarget,
    workspaceDir,
    originSessionKey: params.originSessionKey,
    originSenderId: params.senderId,
    controlPolicy: buildControlPolicy(params, config),
    maxRetriesPerChunk: marathonConfig.maxRetriesPerChunk,
    inputFiles: inputFiles.length > 0 ? inputFiles : undefined,
  });

  // 6. Create watchdog cron job
  let watchdogJobId: string | undefined;
  if (deps.cronService) {
    try {
      const watchdogJob = deps.cronService.add({
        name: `marathon-watchdog:${taskId}`,
        schedule: { type: "every", intervalMs: 5 * 60_000 },
        payload: {
          prompt: "watchdog",
          isolated: true,
          marathonWatchdog: { taskId },
        },
        target: { agentId: "default" },
      });
      watchdogJobId = watchdogJob.id;
      await patchCheckpoint(taskId, { watchdogJobId });
    } catch (err) {
      logger.warn(`Failed to create watchdog cron: ${err}`);
    }
  }

  await updateCheckpointStatus(taskId, "executing");
  emitMarathonTelemetry("marathon_execution_resumed", {
    taskId,
    sessionKey,
    source: "launch",
  });

  // Send plan summary
  const planSummary = plan.chunks
    .map((c, i) => `${i + 1}. **${c.name}** (~${c.estimatedMinutes}min)`)
    .join("\n");
  await deliverText(
    `Marathon plan for \`${taskId}\`:\n\n${planSummary}\n\nStarting execution...`,
    params.deliveryTarget,
    deps,
    { taskId, reason: "plan-summary" },
  );

  // 7. Assemble scoped tools for chunk agents (file + exec + marathon + web)
  const chunkTools = assembleChunkTools(taskId, sessionKey, workspaceDir, deps);

  // Planning slot is no longer needed once execution loop starts.
  planningExecutors.delete(taskId);

  // 8. Run chunk loop
  await runChunkLoop(taskId, sessionKey, workspaceDir, params, deps, chunkTools, watchdogJobId);
}

async function runChunkLoop(
  taskId: string,
  sessionKey: string,
  workspaceDir: string,
  params: LaunchMarathonParams,
  deps: MarathonDeps,
  chunkTools: AgentToolDefinition[],
  watchdogJobId?: string,
): Promise<void> {
  const { config, sessions, containerManager } = deps;
  const marathonConfig = config.marathon;
  if (activeExecutors.has(taskId)) {
    throw new Error(`Marathon ${taskId} already has an active executor loop`);
  }
  const abortController = new AbortController();
  activeExecutors.set(taskId, { abortController });
  emitMarathonTelemetry("marathon_loop_started", { taskId, sessionKey });

  try {
    const startTime = Date.now();

    while (true) {
      if (abortController.signal.aborted) {
        emitMarathonTelemetry("marathon_loop_aborted", { taskId, sessionKey });
        break;
      }

      const checkpoint = await readCheckpoint(taskId);
      if (!checkpoint || checkpoint.status !== "executing") {
        break;
      }

      // Safety caps
      const elapsed = (Date.now() - startTime) / (1000 * 60 * 60);
      if (elapsed > marathonConfig.maxDurationHours) {
        await updateCheckpointStatus(taskId, "failed");
        await deliverText(
          `Marathon \`${taskId}\` exceeded max duration (${marathonConfig.maxDurationHours}h). Pausing.`,
          checkpoint.deliverTo,
          deps,
          { taskId, reason: "duration-exceeded" },
        );
        emitMarathonTelemetry("marathon_failed", {
          taskId,
          sessionKey,
          reason: "duration-exceeded",
          maxDurationHours: marathonConfig.maxDurationHours,
        });
        break;
      }

      if (checkpoint.currentChunkIndex >= checkpoint.plan.chunks.length) {
        break;
      }

      if (checkpoint.currentChunkIndex >= marathonConfig.maxChunks) {
        await updateCheckpointStatus(taskId, "failed");
        await deliverText(
          `Marathon \`${taskId}\` exceeded max chunks (${marathonConfig.maxChunks}).`,
          checkpoint.deliverTo,
          deps,
          { taskId, reason: "max-chunks-exceeded" },
        );
        emitMarathonTelemetry("marathon_failed", {
          taskId,
          sessionKey,
          reason: "max-chunks-exceeded",
          maxChunks: marathonConfig.maxChunks,
        });
        break;
      }

      const chunk = checkpoint.plan.chunks[checkpoint.currentChunkIndex];
      const chunkIndex = checkpoint.currentChunkIndex;
      assertValidChunkDefinition(chunk, taskId, chunkIndex);
      const acceptanceCriteria = chunk.acceptanceCriteria;
      logger.info(
        `Marathon chunk ${chunkIndex + 1}/${checkpoint.plan.chunks.length}: ${chunk.name} (task=${taskId})`,
      );
      emitMarathonTelemetry("marathon_chunk_started", {
        taskId,
        sessionKey,
        chunkIndex,
        chunkName: chunk.name,
      });

      // Build workspace snapshot for fresh-context approach
      const snapshot =
        chunkIndex > 0
          ? await buildWorkspaceSnapshot(workspaceDir, marathonConfig.context)
          : undefined;

      // Build chunk prompt with workspace snapshot (fresh context)
      const isLastChunk = chunkIndex === checkpoint.plan.chunks.length - 1;
      const chunkPrompt = buildChunkPrompt(checkpoint, chunk, isLastChunk, snapshot);
      const chunkStartMs = Date.now();

      // Fresh transcript per chunk — each chunk starts with clean context
      const chunkSessionKey = `${sessionKey}:chunk-${chunkIndex}`;
      const chunkTranscriptPath = resolveTranscriptPath(chunkSessionKey);

      try {
        // Refresh session activity
        const session = sessions.get(sessionKey);
        if (session) {
          session.lastActiveAt = Date.now();
        }

        const result = await runAgentWithAbort(
          {
            prompt: chunkPrompt,
            sessionKey: chunkSessionKey,
            sessionType: "main",
            tier: "subagent",
            transcriptPath: chunkTranscriptPath,
            config,
            sessions,
            tools: chunkTools,
            channel: params.channel,
            senderName: params.senderName,
            workspaceDir,
          },
          abortController.signal,
          CHUNK_TIMEOUT_MS,
          `Marathon chunk "${chunk.name}" timed out after ${CHUNK_TIMEOUT_MS / 1000}s`,
          `Marathon ${taskId} cancelled during chunk "${chunk.name}"`,
        );
        throwIfAborted(
          abortController.signal,
          `Marathon ${taskId} cancelled while processing chunk "${chunk.name}"`,
        );

        // Verify chunk produced files
        const filesWritten = await listFilesRecursive(workspaceDir);
        if (filesWritten.length === 0) {
          throw new Error(
            `Chunk "${chunk.name}" completed but produced no files in workspace. Retrying.`,
          );
        }

        let testStatus;
        if (marathonConfig.testFix.enabled && containerManager) {
          testStatus = await withAbort(
            runTestFixLoop({
              chunkName: chunk.name,
              sessionKey,
              workspaceDir,
              containerManager,
              config,
              testFixConfig: marathonConfig.testFix,
              sessions,
              chunkTools,
              channel: params.channel,
              senderName: params.senderName,
            }),
            abortController.signal,
            `Marathon ${taskId} cancelled during test-fix loop for "${chunk.name}"`,
          );
          throwIfAborted(
            abortController.signal,
            `Marathon ${taskId} cancelled during test-fix loop for "${chunk.name}"`,
          );

          if (testStatus && !testStatus.testsPassed) {
            throw new Error(
              `Chunk "${chunk.name}" failed test-fix loop after ${testStatus.fixIterations} attempts.`,
            );
          }
        }

        // ── Acceptance Criteria Verification Loop ──────────────────
        // Verify criteria. If any fail, re-run the chunk with targeted context.
        let criteriaResult;
        const maxCriteriaRetries = marathonConfig.testFix.maxIterations;

        if (acceptanceCriteria.length > 0) {
          criteriaResult = await verifyAcceptanceCriteria({
            criteria: acceptanceCriteria,
            workspaceDir,
            containerManager,
            sessionKey,
          });

          // Criteria retry loop — fresh context with what passed/failed
          for (
            let attempt = 1;
            !criteriaResult.allPassed && attempt <= maxCriteriaRetries;
            attempt++
          ) {
            logger.info(
              `Criteria check: ${criteriaResult.passCount}/${criteriaResult.results.length} passed for "${chunk.name}", retry ${attempt}/${maxCriteriaRetries}`,
            );
            emitMarathonTelemetry("marathon_chunk_criteria_retry", {
              taskId,
              sessionKey,
              chunkIndex,
              chunkName: chunk.name,
              retryAttempt: attempt,
              maxRetries: maxCriteriaRetries,
              passCount: criteriaResult.passCount,
              failCount: criteriaResult.failCount,
            });

            // Build retry prompt with specific failure context
            const retrySnapshot = await buildWorkspaceSnapshot(
              workspaceDir,
              marathonConfig.context,
            );
            const retryPrompt = buildCriteriaRetryPrompt(
              chunk.name,
              chunk.prompt,
              criteriaResult.results.filter((r) => r.passed).map((r) => r.criterion),
              criteriaResult.results
                .filter((r) => !r.passed)
                .map((r) => ({ criterion: r.criterion, detail: r.detail })),
              attempt,
              maxCriteriaRetries,
              retrySnapshot,
            );

            // Fresh transcript for retry
            const retrySessionKey = `${sessionKey}:chunk-${chunkIndex}:retry-${attempt}`;
            const retryTranscriptPath = resolveTranscriptPath(retrySessionKey);

            await runAgentWithAbort(
              {
                prompt: retryPrompt,
                sessionKey: retrySessionKey,
                sessionType: "main",
                tier: "subagent",
                transcriptPath: retryTranscriptPath,
                config,
                sessions,
                tools: chunkTools,
                channel: params.channel,
                senderName: params.senderName,
                workspaceDir,
              },
              abortController.signal,
              CHUNK_TIMEOUT_MS,
              `Criteria retry ${attempt} for "${chunk.name}" timed out`,
              `Marathon ${taskId} cancelled during criteria retry ${attempt} for "${chunk.name}"`,
            );
            throwIfAborted(
              abortController.signal,
              `Marathon ${taskId} cancelled during criteria verification for "${chunk.name}"`,
            );

            // Re-verify
            criteriaResult = await verifyAcceptanceCriteria({
              criteria: acceptanceCriteria,
              workspaceDir,
              containerManager,
              sessionKey,
            });
          }

          if (criteriaResult.allPassed) {
            logger.info(`All ${criteriaResult.passCount} criteria passed for "${chunk.name}"`);
          } else {
            logger.warn(
              `Criteria incomplete for "${chunk.name}": ${criteriaResult.passCount}/${criteriaResult.results.length} passed after ${maxCriteriaRetries} retries`,
            );
          }
        }

        const chunkResult: ChunkResult = {
          chunkName: chunk.name,
          status: "completed",
          summary: result.text.slice(0, 500),
          filesWritten,
          durationMs: Date.now() - chunkStartMs,
          completedAt: Date.now(),
          failedAttempts: 0,
          testStatus: testStatus ?? undefined,
          criteriaResult: criteriaResult ?? undefined,
        };

        // Write PROGRESS.md before advancing checkpoint
        await writeProgressFile(workspaceDir, checkpoint, chunkResult);

        const updated = await advanceCheckpoint(taskId, chunkResult);
        emitMarathonTelemetry("marathon_chunk_completed", {
          taskId,
          sessionKey,
          chunkIndex,
          chunkName: chunk.name,
          durationMs: chunkResult.durationMs,
          filesWritten: filesWritten.length,
        });

        // Send progress update
        if ((chunkIndex + 1) % marathonConfig.progress.notifyEveryNChunks === 0) {
          await sendMarathonProgressUpdate(updated, deps, emitMarathonTelemetry);
        }

        // Check if completed
        if (updated.status === "completed") {
          await onMarathonComplete(taskId, sessionKey, updated, deps, watchdogJobId);
          return;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (isAbortError(err, abortController.signal)) {
          logger.info(`Marathon aborted: task=${taskId}`);
          emitMarathonTelemetry("marathon_loop_aborted", { taskId, sessionKey });
          break;
        }

        logger.error(`Chunk failed: ${chunk.name} (task=${taskId}): ${errMsg}`);
        emitMarathonTelemetry("marathon_chunk_failed", {
          taskId,
          sessionKey,
          chunkIndex,
          chunkName: chunk.name,
          error: errMsg,
        });

        // Auth errors should immediately pause — retrying won't help
        if (errMsg.includes("authentication_error") || errMsg.includes("401")) {
          await pauseCheckpoint(taskId);
          emitMarathonTelemetry("marathon_paused", {
            taskId,
            sessionKey,
            reason: "authentication_error",
          });
          await deliverText(
            `Marathon \`${taskId}\` paused: authentication error. Your Claude token has expired.\n\n` +
              `**Fix:** Add \`ANTHROPIC_API_KEY=sk-ant-...\` to \`~/.jinx/.env\` for a non-expiring credential.\n` +
              `Create an API key at https://console.anthropic.com/settings/keys\n\n` +
              `Then resume: \`/marathon resume ${taskId}\``,
            checkpoint.deliverTo,
            deps,
            { taskId, reason: "auth-pause" },
          );
          break;
        }

        const updated = await failChunk(taskId, errMsg);
        if (updated.status === "paused") {
          emitMarathonTelemetry("marathon_paused", {
            taskId,
            sessionKey,
            reason: "chunk-retries-exhausted",
            chunkName: chunk.name,
          });
          await deliverText(
            `Marathon \`${taskId}\` paused: chunk "${chunk.name}" failed after ${updated.maxRetriesPerChunk} attempts.\nLast error: ${errMsg}\n\nUse \`/marathon resume ${taskId}\` to retry.`,
            updated.deliverTo,
            deps,
            { taskId, reason: "retry-exhausted-pause" },
          );
          break;
        }
        // Retry — same chunk, don't advance
      }

      // Interval between chunks
      if (marathonConfig.chunkIntervalMs > 0) {
        await sleep(marathonConfig.chunkIntervalMs, abortController.signal);
      }
    }
  } finally {
    activeExecutors.delete(taskId);
    emitMarathonTelemetry("marathon_loop_stopped", { taskId, sessionKey });
  }
}

// ── Marathon Completion ─────────────────────────────────────────────

async function onMarathonComplete(
  taskId: string,
  sessionKey: string,
  checkpoint: MarathonCheckpoint,
  deps: MarathonDeps,
  watchdogJobId?: string,
): Promise<void> {
  logger.info(`Marathon completed: task=${taskId}`);
  emitMarathonTelemetry("marathon_completed", {
    taskId,
    sessionKey,
    completedChunks: checkpoint.completedChunks.length,
  });

  // Remove watchdog cron job
  if (watchdogJobId && deps.cronService) {
    deps.cronService.remove(watchdogJobId);
  }

  // Try deliverables manifest first, then auto-detect, then fall back to full workspace ZIP
  const deliverableMedia = await packageDeliverables(
    checkpoint.workspaceDir,
    taskId,
    checkpoint.inputFiles,
  );

  const summary = checkpoint.completedChunks
    .map((c, i) => `${i + 1}. **${c.chunkName}** (${Math.round(c.durationMs / 1000)}s)`)
    .join("\n");

  const deliveredNames = deliverableMedia
    .map((item) => item.filename)
    .filter((name): name is string => Boolean(name))
    .slice(0, 5);
  const sourceLikeDeliverables = deliveredNames.filter((name) =>
    SOURCE_LIKE_DELIVERABLE_EXTENSIONS.has(path.extname(name).toLowerCase().slice(1)),
  );

  let text = `Marathon \`${taskId}\` complete!\n\n**Chunks completed:** ${checkpoint.completedChunks.length}\n\n${summary}`;
  if (deliveredNames.length > 0) {
    text += `\n\nArtifacts attached: ${deliveredNames.join(", ")}`;
  }
  if (sourceLikeDeliverables.length > 0) {
    text +=
      "\nNote: Some attached artifacts look like source/workspace files and may require local build/run steps.";
  }

  await deliverMarathonPayload({
    text,
    media: deliverableMedia,
    target: checkpoint.deliverTo,
    deps,
    emitTelemetry: emitMarathonTelemetry,
    context: {
      taskId,
      reason: "completion",
    },
  });

  // Keep container alive for post-completion inspection
  if (deps.containerManager) {
    deps.containerManager.setRetention(sessionKey, deps.config.marathon.completionRetentionMs);
  }
}

// ── Resume / Cancel / Status ────────────────────────────────────────

/** Resume a paused or stalled marathon from its last checkpoint. */
export async function resumeMarathon(taskId: string, deps: MarathonDeps): Promise<void> {
  if (activeExecutors.has(taskId)) {
    throw new Error(`Marathon ${taskId} is already running`);
  }

  const checkpoint = await readCheckpoint(taskId);
  if (!checkpoint) {
    throw new Error(`Marathon not found: ${taskId}`);
  }

  if (checkpoint.status !== "paused" && checkpoint.status !== "executing") {
    throw new Error(`Marathon ${taskId} is ${checkpoint.status}, cannot resume`);
  }

  // Reattach container if needed
  if (deps.containerManager && checkpoint.containerId) {
    const alive = await deps.containerManager.reattach(
      checkpoint.containerId,
      checkpoint.sessionKey,
      checkpoint.workspaceDir,
    );
    if (!alive) {
      logger.info(`Container dead, recreating for marathon ${taskId}`);
      const containerSession = await deps.containerManager.getOrCreate(
        checkpoint.sessionKey,
        checkpoint.workspaceDir,
      );
      deps.containerManager.promote(checkpoint.sessionKey);
      await patchCheckpoint(taskId, { containerId: containerSession.containerId });
    }
  }

  // Reset per-chunk failedAttempts so the resumed chunk gets a fresh retry budget.
  if (checkpoint.status === "paused") {
    await resetCurrentChunkRetries(taskId);
  }
  await updateCheckpointStatus(taskId, "executing");
  emitMarathonTelemetry("marathon_execution_resumed", {
    taskId,
    sessionKey: checkpoint.sessionKey,
    source: checkpoint.status,
  });

  // Assemble scoped tools for resumed chunk agents
  const chunkTools = assembleChunkTools(
    taskId,
    checkpoint.sessionKey,
    checkpoint.workspaceDir,
    deps,
  );

  // Resume the chunk loop
  runChunkLoop(
    taskId,
    checkpoint.sessionKey,
    checkpoint.workspaceDir,
    {
      prompt: "",
      originSessionKey: checkpoint.originSessionKey,
      deliveryTarget: checkpoint.deliverTo,
      channel: checkpoint.deliverTo.channel,
      senderName: "system",
    },
    deps,
    chunkTools,
    checkpoint.watchdogJobId,
  ).catch((err) => {
    logger.error(`Resume marathon failed (task=${taskId}): ${err}`);
    const msg = err instanceof Error ? err.message : String(err);
    emitMarathonTelemetry("marathon_resume_failed", {
      taskId,
      sessionKey: checkpoint.sessionKey,
      error: msg,
    });
  });
}

/** Cancel a marathon task. */
export async function cancelMarathon(taskId: string, deps: MarathonDeps): Promise<void> {
  const checkpoint = await readCheckpoint(taskId);
  if (!checkpoint) {
    throw new Error(`Marathon not found: ${taskId}`);
  }

  planningExecutors.delete(taskId);
  await cancelCheckpoint(taskId);
  emitMarathonTelemetry("marathon_cancelled", {
    taskId,
    sessionKey: checkpoint.sessionKey,
  });

  const executor = activeExecutors.get(taskId);
  if (executor) {
    executor.abortController.abort();
  }

  if (checkpoint.watchdogJobId && deps.cronService) {
    deps.cronService.remove(checkpoint.watchdogJobId);
  }

  if (deps.containerManager) {
    await deps.containerManager.stop(checkpoint.sessionKey);
  }

  logger.info(`Marathon cancelled: task=${taskId}`);
}

/** Get all marathon checkpoints (for status queries). */
export async function getMarathonStatus(): Promise<MarathonCheckpoint[]> {
  return listCheckpoints();
}

/** Check if an executor loop is alive for the given task. */
export function isExecutorAlive(taskId: string): boolean {
  return activeExecutors.has(taskId);
}

/** @internal Test-only helper to clear in-memory marathon runtime state. */
export function __resetMarathonRuntimeStateForTests(): void {
  for (const executor of activeExecutors.values()) {
    executor.abortController.abort();
  }
  activeExecutors.clear();
  planningExecutors.clear();
}

// ── Workspace Media Seeding ─────────────────────────────────────────

/** Map common MIME types to file extensions. */
const MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/plain": "txt",
};

/**
 * Write user-provided media attachments into the marathon workspace directory.
 * @internal Exported for testing.
 */
export async function seedWorkspaceMedia(
  workspaceDir: string,
  media: MediaAttachment[] | undefined,
): Promise<InputFileInfo[]> {
  if (!media || media.length === 0) {
    return [];
  }

  const results: InputFileInfo[] = [];
  for (const attachment of media) {
    if (!attachment.buffer || attachment.buffer.length === 0) {
      continue;
    }

    const filename = resolveMediaFilename(attachment, results.length);
    const filePath = path.join(workspaceDir, filename);
    await fs.writeFile(filePath, attachment.buffer);

    results.push({
      name: filename,
      sizeBytes: attachment.buffer.length,
      mimeType: attachment.mimeType,
    });
    logger.info(`Seeded workspace media: ${filename} (${attachment.buffer.length} bytes)`);
  }
  return results;
}

function resolveMediaFilename(attachment: MediaAttachment, index: number): string {
  if (attachment.filename) {
    return attachment.filename;
  }

  const ext = MIME_EXTENSIONS[attachment.mimeType] ?? attachment.mimeType.split("/")[1] ?? "bin";
  const prefix = `input-${attachment.type}`;
  return index === 0 ? `${prefix}.${ext}` : `${prefix}-${index + 1}.${ext}`;
}

// ── Tool Assembly ───────────────────────────────────────────────────

function assembleChunkTools(
  taskId: string,
  sessionKey: string,
  workspaceDir: string,
  deps: MarathonDeps,
): AgentToolDefinition[] {
  const { config, containerManager } = deps;
  const tools: AgentToolDefinition[] = [];

  tools.push(
    ...getCoreToolDefinitions({
      allowedDirs: [workspaceDir],
      sessionType: "main",
    }),
  );

  if (containerManager && config.sandbox?.enabled !== false) {
    tools.push(
      ...getExecToolDefinitions({
        workspaceDir,
        sandboxConfig: config.sandbox,
        sessionKey,
        containerManager,
      }),
    );
  }

  tools.push(...getMarathonToolDefinitions({ taskId }));

  const webSearch = config.webSearch;
  if (webSearch?.enabled !== false) {
    tools.push(
      ...getWebSearchToolDefinitions({
        apiKey: webSearch?.apiKey,
        model: webSearch?.model,
        timeoutSeconds: webSearch?.timeoutSeconds,
        cacheTtlMinutes: webSearch?.cacheTtlMinutes,
      }),
    );
  }

  tools.push(
    ...getWebFetchToolDefinitions({
      cacheTtlMinutes: webSearch?.cacheTtlMinutes,
    }),
  );

  return tools;
}

// ── Deliverables Metadata ──────────────────────────────────────────

const SOURCE_LIKE_DELIVERABLE_EXTENSIONS = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "php",
  "swift",
  "kt",
  "scala",
  "sh",
  "bash",
  "zsh",
]);

async function deliverText(
  text: string,
  target: DeliveryTarget,
  deps: MarathonDeps,
  context?: { taskId?: string; reason?: string },
): Promise<void> {
  await deliverMarathonPayload({
    text,
    media: [],
    target,
    deps,
    emitTelemetry: emitMarathonTelemetry,
    context,
  });
}

// ── Utilities ───────────────────────────────────────────────────────

// Re-export for backward compatibility
export { parsePlanFromResult } from "./marathon-prompts.js";
export { formatFileSize } from "./marathon-prompts.js";
export {
  autoDetectDeliverables,
  isManifestDeliverablePath,
  selectProgressArtifacts,
} from "./marathon-artifacts.js";

function emitMarathonTelemetry(event: string, metadata: Record<string, unknown>): void {
  logProductTelemetry({
    area: "marathon",
    event,
    ...metadata,
  });
}

async function runAgentWithAbort(
  options: Parameters<typeof runAgent>[0],
  signal: AbortSignal,
  timeoutMs: number,
  timeoutMessage: string,
  abortMessage: string,
) {
  return withAbort(withTimeout(runAgent(options), timeoutMs, timeoutMessage), signal, abortMessage);
}

function throwIfAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) {
    throw new Error(message);
  }
}

async function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  abortMessage: string,
): Promise<T> {
  if (signal.aborted) {
    throw new Error(abortMessage);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error(abortMessage));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /aborted|cancelled/i.test(msg);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
