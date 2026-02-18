import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentResult } from "../providers/types.js";
import type { ChannelId } from "../types/config.js";
import type { DeliveryTarget, OutboundMedia } from "../types/messages.js";
import type { DispatchDeps } from "./dispatch.js";
import { runAgent } from "../agents/runner.js";
import { deliverWithRetryAndFallback } from "../delivery/reliable.js";
import { createLogger } from "../infra/logger.js";
import { logProductTelemetry } from "../infra/product-telemetry.js";
import { withTimeout } from "../infra/timeout.js";
import { createSessionEntry } from "../sessions/store.js";
import { resolveTranscriptPath } from "../sessions/transcript.js";
import { ensureTaskDir, resolveTaskDir } from "../workspace/task-dir.js";
import { emitStreamEvent } from "./streaming.js";

const logger = createLogger("deep-work");

/** Max time for a deep work agent turn. */
const DEEP_WORK_TIMEOUT_MS = 30 * 60_000; // 30 minutes

/** MIME types for common text file extensions. */
const TEXT_MIME: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".ts": "text/typescript",
  ".js": "text/javascript",
  ".py": "text/x-python",
};

export interface DeepWorkParams {
  /** The enveloped prompt to send to the agent. */
  prompt: string;
  /** Session key of the originating conversation (for ack delivery). */
  originSessionKey: string;
  /** Where to deliver the final result. */
  deliveryTarget: DeliveryTarget;
  /** Channel the message came from. */
  channel: ChannelId;
  /** Sender display name. */
  senderName: string;
}

/**
 * Launch a deep-work session in the background.
 * Emits an ack to the origin session, then fires-and-forgets the actual work.
 */
export function launchDeepWork(params: DeepWorkParams, deps: DispatchDeps): void {
  const shortId = crypto.randomUUID().slice(0, 8);
  const sessionKey = `deepwork:${shortId}`;

  // Emit ack on the origin session stream so the channel picks it up
  emitStreamEvent(params.originSessionKey, {
    type: "final",
    text: "Working on this — I'll get back to you when it's done.",
  });

  // Fire-and-forget — errors are logged, never thrown to caller
  executeDeepWork(sessionKey, params, deps).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Deep work failed (session=${sessionKey}): ${msg}`);
  });
}

async function executeDeepWork(
  sessionKey: string,
  params: DeepWorkParams,
  deps: DispatchDeps,
): Promise<void> {
  const { config, sessions } = deps;

  // Create scoped task directory for deep work outputs
  const shortId = sessionKey.replace("deepwork:", "");
  const taskDir = resolveTaskDir("deepwork", shortId);
  await ensureTaskDir(taskDir);

  // Create an isolated session for this deep work
  const transcriptPath = resolveTranscriptPath(sessionKey);
  const session = createSessionEntry({
    sessionKey,
    agentId: "default",
    channel: params.channel,
    transcriptPath,
    parentSessionKey: params.originSessionKey,
  });
  session.taskDir = taskDir;
  sessions.set(sessionKey, session);

  logger.info(`Deep work started: session=${sessionKey} origin=${params.originSessionKey}`);

  // Tell the agent its output will be auto-delivered to the messaging channel,
  // so it should include full content inline rather than writing to files.
  const deliveryNote =
    `\n\n[System: This is an async deep-work task. Your entire response will be ` +
    `automatically delivered to ${params.channel}. Include the FULL content in your ` +
    `response text — do not just write to a file, as the user may be on mobile and ` +
    `cannot access local files. If you do write files, they will be sent as document ` +
    `attachments. Do NOT try to send messages yourself — just produce the content directly.]`;

  let resultText: string;
  let writtenFiles: OutboundMedia[] = [];
  try {
    const agentResult = await withTimeout(
      runAgent({
        prompt: params.prompt + deliveryNote,
        sessionKey,
        sessionType: "main",
        tier: "brain",
        transcriptPath,
        config,
        sessions,
        searchManager: deps.searchManager,
        cronService: deps.cronService,
        channels: deps.channels,
        containerManager: deps.containerManager,
        channel: params.channel,
        senderName: params.senderName,
        workspaceDir: taskDir,
      }),
      DEEP_WORK_TIMEOUT_MS,
      `Deep work timed out after ${DEEP_WORK_TIMEOUT_MS / 1000}s`,
    );

    session.turnCount++;
    session.totalInputTokens += agentResult.usage.inputTokens;
    session.totalOutputTokens += agentResult.usage.outputTokens;
    resultText = agentResult.text;
    writtenFiles = await extractWrittenFiles(agentResult);
    logger.info(
      `Deep work completed: session=${sessionKey} (${agentResult.durationMs}ms, ${writtenFiles.length} files)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Deep work error: session=${sessionKey}: ${msg}`);
    resultText = `Sorry, I wasn't able to finish the deep work task: ${msg}`;
  }

  // Deliver the result back to the originating channel
  await deliverResult(resultText, writtenFiles, params.deliveryTarget, deps);
}

/**
 * Scan agent result for file-write tool calls, read those files,
 * and return them as OutboundMedia documents for attachment.
 */
async function extractWrittenFiles(agentResult: AgentResult): Promise<OutboundMedia[]> {
  const media: OutboundMedia[] = [];

  for (const msg of agentResult.messages) {
    if (!msg.toolCalls) {
      continue;
    }
    for (const tc of msg.toolCalls) {
      if (tc.name !== "write") {
        continue;
      }
      const input = tc.input as { path?: string } | undefined;
      if (!input?.path) {
        continue;
      }

      try {
        const buffer = await fs.readFile(input.path);
        const ext = path.extname(input.path).toLowerCase();
        const mimeType = TEXT_MIME[ext] ?? "application/octet-stream";
        const filename = path.basename(input.path);

        media.push({
          type: "document",
          mimeType,
          buffer: new Uint8Array(buffer),
          filename,
        });
        logger.info(`Attaching file: ${filename} (${buffer.length} bytes)`);
      } catch (err) {
        logger.warn(`Could not read written file ${input.path}: ${err}`);
      }
    }
  }

  return media;
}

async function deliverResult(
  text: string,
  media: OutboundMedia[],
  target: DeliveryTarget,
  deps: DispatchDeps,
): Promise<void> {
  const result = await deliverWithRetryAndFallback({
    payload: { text, media: media.length > 0 ? media : undefined },
    target,
    deps: {
      getChannel: (name) => deps.channels?.get(name),
    },
    source: "deep-work",
    reason: "completion",
    maxAttempts: 3,
    retryBaseMs: 100,
    retryMaxMs: 800,
    terminalText: text,
    emitFallback: (sessionKey, fallbackText) => {
      emitStreamEvent(sessionKey, { type: "final", text: fallbackText });
    },
    onAttemptFailed: (metadata) => {
      logProductTelemetry({
        area: "delivery",
        event: "deep_work_delivery_attempt_failed",
        channel: target.channel,
        reason: metadata.reason,
        attempt: metadata.attempt,
        maxAttempts: metadata.maxAttempts,
        error: metadata.error,
      });
    },
    onSucceeded: (metadata) => {
      logProductTelemetry({
        area: "delivery",
        event: "deep_work_delivery_succeeded",
        channel: target.channel,
        reason: metadata.reason,
        attempts: metadata.attempts,
        textChunks: metadata.textChunks,
        mediaItems: metadata.mediaItems,
      });
    },
    onFallback: (metadata) => {
      logProductTelemetry({
        area: "delivery",
        event: "deep_work_delivery_fallback_terminal",
        channel: target.channel,
        reason: metadata.reason,
        error: metadata.error,
        deadLetterPath: metadata.deadLetterPath,
      });
    },
  });

  if (result.success) {
    logger.info(
      `Deep work delivered: ${target.channel}:${target.to} (attempts=${result.attempts}, media=${media.length})`,
    );
    return;
  }

  logger.warn(`Deep work delivery failed after ${result.attempts} attempts: ${result.error}`);
}
