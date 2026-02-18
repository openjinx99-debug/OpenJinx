import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ChannelPlugin } from "../types/channels.js";
import type { DeliveryTarget, ReplyPayload, OutboundMedia } from "../types/messages.js";
import { homeRelative } from "../infra/home-dir.js";
import { createLogger } from "../infra/logger.js";
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from "../infra/security.js";
import { chunkText } from "../markdown/chunk.js";
import { deliverOutboundPayloads } from "./deliver.js";

const logger = createLogger("delivery:reliable");

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 8_000;
const DEFAULT_TERMINAL_SESSION_KEY = "terminal:dm:local";
const DEFAULT_DEAD_LETTER_PATH = homeRelative("delivery/dead-letter.jsonl");

interface DeadLetterEntry {
  id: string;
  timestamp: number;
  source: string;
  reason: string;
  taskId?: string;
  attempts: number;
  error: string;
  target: DeliveryTarget;
  payload: {
    text: string;
    media: Array<{
      type: OutboundMedia["type"];
      mimeType: string;
      filename?: string;
      sizeBytes?: number;
      url?: string;
    }>;
  };
}

export interface ReliableDeliveryOptions {
  payload: ReplyPayload;
  target: DeliveryTarget;
  deps: {
    getChannel: (name: string) => ChannelPlugin | undefined;
  };
  source: "marathon" | "deep-work" | "heartbeat" | "cron" | "chat";
  reason: string;
  taskId?: string;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  deadLetterPath?: string;
  /** Override text used for terminal failback delivery. */
  terminalText?: string;
  terminalSessionKey?: string;
  emitFallback?: (sessionKey: string, text: string) => void;
  onAttemptFailed?: (metadata: Record<string, unknown>) => void;
  onSucceeded?: (metadata: Record<string, unknown>) => void;
  onFallback?: (metadata: Record<string, unknown>) => void;
}

export interface ReliableDeliveryResult {
  success: boolean;
  attempts: number;
  error?: string;
  deadLetterPath?: string;
  fallbackDelivered: boolean;
}

/**
 * Deliver payloads with retry + dead-letter + terminal failback.
 * Guarantees at-least-once attempt semantics, not exactly-once delivery.
 */
export async function deliverWithRetryAndFallback(
  opts: ReliableDeliveryOptions,
): Promise<ReliableDeliveryResult> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryBaseMs = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const retryMaxMs = opts.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
  const deadLetterPath = opts.deadLetterPath ?? DEFAULT_DEAD_LETTER_PATH;

  let lastError = "unknown delivery error";
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    const channel = opts.deps.getChannel(opts.target.channel);

    if (!channel?.isReady()) {
      lastError = `Channel not ready: ${opts.target.channel}`;
      opts.onAttemptFailed?.({
        source: opts.source,
        taskId: opts.taskId,
        channel: opts.target.channel,
        reason: opts.reason,
        attempt,
        maxAttempts,
        error: lastError,
      });
    } else {
      const result = await deliverOutboundPayloads({
        payload: opts.payload,
        target: opts.target,
        deps: {
          getChannel: opts.deps.getChannel,
          chunkText,
        },
      });

      if (result.success) {
        opts.onSucceeded?.({
          source: opts.source,
          taskId: opts.taskId,
          channel: opts.target.channel,
          reason: opts.reason,
          attempts: attempt,
          textChunks: result.textChunks,
          mediaItems: result.mediaItems,
        });
        return {
          success: true,
          attempts: attempt,
          fallbackDelivered: false,
        };
      }

      lastError = result.error ?? "delivery failed";
      opts.onAttemptFailed?.({
        source: opts.source,
        taskId: opts.taskId,
        channel: opts.target.channel,
        reason: opts.reason,
        attempt,
        maxAttempts,
        error: lastError,
      });
    }

    if (attempt < maxAttempts) {
      await sleep(computeDelayMs(attempt, retryBaseMs, retryMaxMs));
    }
  }

  const writtenDeadLetterPath = await appendDeadLetter(
    {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: opts.source,
      reason: opts.reason,
      taskId: opts.taskId,
      attempts,
      error: lastError,
      target: opts.target,
      payload: {
        text: opts.payload.text?.slice(0, 20_000) ?? "",
        media: (opts.payload.media ?? []).map((item) => ({
          type: item.type,
          mimeType: item.mimeType,
          filename: item.filename,
          sizeBytes: item.buffer?.byteLength,
          url: item.url,
        })),
      },
    },
    deadLetterPath,
  );

  let fallbackDelivered = false;
  const emitFallback = opts.emitFallback;
  if (emitFallback) {
    let text = opts.terminalText ?? opts.payload.text ?? "";
    const mediaCount = opts.payload.media?.length ?? 0;
    if (mediaCount > 0) {
      text += `\n\n[Delivery fallback: ${mediaCount} attachment(s) logged to ${writtenDeadLetterPath}]`;
    }
    if (text.trim().length > 0) {
      emitFallback(opts.terminalSessionKey ?? DEFAULT_TERMINAL_SESSION_KEY, text);
      fallbackDelivered = true;
    }
  }

  opts.onFallback?.({
    source: opts.source,
    taskId: opts.taskId,
    channel: opts.target.channel,
    reason: opts.reason,
    error: lastError,
    deadLetterPath: writtenDeadLetterPath,
    fallbackDelivered,
  });

  return {
    success: false,
    attempts,
    error: lastError,
    deadLetterPath: writtenDeadLetterPath,
    fallbackDelivered,
  };
}

async function appendDeadLetter(entry: DeadLetterEntry, deadLetterPath: string): Promise<string> {
  try {
    const dir = path.dirname(deadLetterPath);
    await fs.mkdir(dir, { recursive: true, mode: SECURE_DIR_MODE });
    await fs.appendFile(deadLetterPath, `${JSON.stringify(entry)}\n`, { mode: SECURE_FILE_MODE });
  } catch (err) {
    logger.error(`Failed writing dead-letter entry: ${err}`);
  }
  return deadLetterPath;
}

function computeDelayMs(attempt: number, retryBaseMs: number, retryMaxMs: number): number {
  const delay = retryBaseMs * Math.pow(2, Math.max(attempt - 1, 0));
  return Math.min(delay, retryMaxMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
