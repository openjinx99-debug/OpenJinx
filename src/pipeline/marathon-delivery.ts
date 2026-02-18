import path from "node:path";
import type { ChannelPlugin } from "../types/channels.js";
import type { JinxConfig } from "../types/config.js";
import type { MarathonCheckpoint, DeliveryTarget } from "../types/marathon.js";
import type { OutboundMedia } from "../types/messages.js";
import { deliverWithRetryAndFallback } from "../delivery/reliable.js";
import { createLogger } from "../infra/logger.js";
import { resolveMarathonDir } from "./checkpoint.js";
import { selectProgressArtifacts } from "./marathon-artifacts.js";
import { emitStreamEvent } from "./streaming.js";

const logger = createLogger("marathon-delivery");

const DELIVERY_MAX_ATTEMPTS = 3;
const DELIVERY_RETRY_BASE_MS = 1;
const DELIVERY_RETRY_MAX_MS = 5;

interface DeliveryContext {
  taskId?: string;
  reason?: string;
}

export interface MarathonDeliveryDeps {
  config: Pick<JinxConfig, "marathon">;
  channels?: Map<string, ChannelPlugin>;
}

export type MarathonTelemetryEmitter = (
  event: string,
  metadata: Record<string, unknown>,
) => void;

export interface DeliverMarathonPayloadOptions {
  text: string;
  media: OutboundMedia[];
  target: DeliveryTarget;
  deps: MarathonDeliveryDeps;
  emitTelemetry: MarathonTelemetryEmitter;
  context?: DeliveryContext;
}

export async function deliverMarathonPayload(opts: DeliverMarathonPayloadOptions): Promise<void> {
  const reason = opts.context?.reason ?? "unspecified";
  const payload = { text: opts.text, media: opts.media.length > 0 ? opts.media : undefined };
  const deadLetterPath = path.join(resolveMarathonDir(), "dead-letter.jsonl");

  const result = await deliverWithRetryAndFallback({
    payload,
    target: opts.target,
    deps: {
      getChannel: (name) => opts.deps.channels?.get(name),
    },
    source: "marathon",
    reason,
    taskId: opts.context?.taskId,
    maxAttempts: DELIVERY_MAX_ATTEMPTS,
    retryBaseMs: DELIVERY_RETRY_BASE_MS,
    retryMaxMs: DELIVERY_RETRY_MAX_MS,
    deadLetterPath,
    terminalText: opts.text,
    emitFallback: (sessionKey, fallbackText) => {
      emitStreamEvent(sessionKey, { type: "final", text: fallbackText });
    },
    onAttemptFailed: (metadata) => {
      opts.emitTelemetry("marathon_delivery_attempt_failed", {
        taskId: opts.context?.taskId,
        channel: opts.target.channel,
        reason,
        attempt: metadata.attempt,
        maxAttempts: metadata.maxAttempts,
        error: metadata.error,
      });
    },
    onSucceeded: (metadata) => {
      opts.emitTelemetry("marathon_delivery_succeeded", {
        taskId: opts.context?.taskId,
        channel: opts.target.channel,
        attempts: metadata.attempts,
        reason,
        textChunks: metadata.textChunks,
        mediaItems: metadata.mediaItems,
      });
    },
    onFallback: (metadata) => {
      opts.emitTelemetry("marathon_delivery_fallback_terminal", {
        taskId: opts.context?.taskId,
        channel: opts.target.channel,
        reason,
        attempts: metadata.attempts,
        error: metadata.error,
        deadLetterPath: metadata.deadLetterPath,
      });
    },
  });

  if (!result.success) {
    logger.warn(
      `Marathon delivery failed after ${result.attempts} attempts: ${result.error ?? "unknown error"}`,
    );
  }
}

export function buildProgressUpdateText(
  checkpoint: MarathonCheckpoint,
  includeFileSummary: boolean,
): string {
  const total = checkpoint.plan.chunks.length;
  const done = checkpoint.currentChunkIndex;
  const lastChunk = checkpoint.completedChunks[checkpoint.completedChunks.length - 1];
  const progressPct = Math.round((done / total) * 100);

  let text = `Marathon \`${checkpoint.taskId}\` progress: ${done}/${total} chunks (${progressPct}%)`;
  if (lastChunk) {
    text += `\nLast completed: **${lastChunk.chunkName}**`;
    if (includeFileSummary && lastChunk.filesWritten.length > 0) {
      const likelyOutputs = selectProgressArtifacts(lastChunk.filesWritten);
      if (likelyOutputs.length > 0) {
        text += `\nLikely outputs: ${likelyOutputs.join(", ")}`;
      } else {
        text += `\nWorkspace updated (${lastChunk.filesWritten.length} files tracked).`;
      }
    }
  }

  return text;
}

export async function sendMarathonProgressUpdate(
  checkpoint: MarathonCheckpoint,
  deps: MarathonDeliveryDeps,
  emitTelemetry: MarathonTelemetryEmitter,
): Promise<void> {
  const text = buildProgressUpdateText(
    checkpoint,
    deps.config.marathon.progress.includeFileSummary,
  );
  const total = checkpoint.plan.chunks.length;
  const done = checkpoint.currentChunkIndex;
  const progressPct = Math.round((done / total) * 100);

  await deliverMarathonPayload({
    text,
    media: [],
    target: checkpoint.deliverTo,
    deps,
    emitTelemetry,
    context: { taskId: checkpoint.taskId, reason: "progress" },
  });

  emitTelemetry("marathon_progress_notified", {
    taskId: checkpoint.taskId,
    done,
    total,
    progressPct,
  });
}
