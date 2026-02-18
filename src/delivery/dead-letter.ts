import fs from "node:fs/promises";
import path from "node:path";
import type { DeliveryTarget, OutboundMedia } from "../types/messages.js";
import { homeRelative } from "../infra/home-dir.js";
import { createLogger } from "../infra/logger.js";
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from "../infra/security.js";
import { resolveMarathonDir } from "../pipeline/checkpoint.js";

const logger = createLogger("delivery:dead-letter");

export interface DeadLetterMediaMeta {
  type: OutboundMedia["type"];
  mimeType: string;
  filename?: string;
  sizeBytes?: number;
  url?: string;
}

export interface DeliveryDeadLetterEntry {
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
    media: DeadLetterMediaMeta[];
  };
  deadLetterPath?: string;
}

export interface ReadDeadLettersOptions {
  paths?: string[];
  since?: number;
  limit?: number;
}

export interface DeadLetterSummary {
  total: number;
  oldestTimestamp?: number;
  latestTimestamp?: number;
  bySource: Record<string, number>;
  byChannel: Record<string, number>;
  byReason: Record<string, number>;
}

export interface DeadLetterReplayRecord {
  timestamp: number;
  deadLetterId: string;
  status: "success" | "failed" | "dry-run" | "skipped";
  channel: string;
  to: string;
  error?: string;
  forced?: boolean;
}

function getDeliveryDeadLetterPath(): string {
  return homeRelative("delivery/dead-letter.jsonl");
}

export function getDeadLetterPaths(): string[] {
  return [
    ...new Set([getDeliveryDeadLetterPath(), path.join(resolveMarathonDir(), "dead-letter.jsonl")]),
  ];
}

export function getReplayLogPath(): string {
  return homeRelative("delivery/dead-letter-replay.jsonl");
}

export async function readDeadLetterEntries(
  options: ReadDeadLettersOptions = {},
): Promise<DeliveryDeadLetterEntry[]> {
  const paths = options.paths && options.paths.length > 0 ? options.paths : getDeadLetterPaths();
  const entries: DeliveryDeadLetterEntry[] = [];

  for (const filePath of paths) {
    let data: string;
    try {
      data = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      logger.warn(`Failed to read dead-letter file ${filePath}: ${err}`);
      continue;
    }

    for (const line of data.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as unknown;
        const entry = normalizeDeadLetterEntry(parsed);
        if (!entry) {
          continue;
        }
        entry.deadLetterPath = filePath;
        if (options.since !== undefined && entry.timestamp < options.since) {
          continue;
        }
        entries.push(entry);
      } catch {
        logger.debug(`Skipping malformed dead-letter line from ${filePath}: ${line.slice(0, 80)}`);
      }
    }
  }

  entries.sort((a, b) => b.timestamp - a.timestamp);
  if (options.limit !== undefined && options.limit >= 0) {
    return entries.slice(0, options.limit);
  }
  return entries;
}

export function summarizeDeadLetters(entries: DeliveryDeadLetterEntry[]): DeadLetterSummary {
  const bySource: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  let oldestTimestamp: number | undefined;
  let latestTimestamp: number | undefined;

  for (const entry of entries) {
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
    byChannel[entry.target.channel] = (byChannel[entry.target.channel] ?? 0) + 1;
    byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1;
    oldestTimestamp =
      oldestTimestamp === undefined ? entry.timestamp : Math.min(oldestTimestamp, entry.timestamp);
    latestTimestamp =
      latestTimestamp === undefined ? entry.timestamp : Math.max(latestTimestamp, entry.timestamp);
  }

  return {
    total: entries.length,
    oldestTimestamp,
    latestTimestamp,
    bySource,
    byChannel,
    byReason,
  };
}

export async function readDeadLetterReplayRecords(
  replayLogPath = getReplayLogPath(),
): Promise<DeadLetterReplayRecord[]> {
  let data: string;
  try {
    data = await fs.readFile(replayLogPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const records: DeadLetterReplayRecord[] = [];
  for (const line of data.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as DeadLetterReplayRecord;
      if (
        typeof parsed.timestamp === "number" &&
        typeof parsed.deadLetterId === "string" &&
        typeof parsed.status === "string" &&
        typeof parsed.channel === "string" &&
        typeof parsed.to === "string"
      ) {
        records.push(parsed);
      }
    } catch {
      logger.debug(`Skipping malformed replay-log line: ${line.slice(0, 80)}`);
    }
  }
  return records;
}

export async function appendDeadLetterReplayRecord(
  record: DeadLetterReplayRecord,
  replayLogPath = getReplayLogPath(),
): Promise<void> {
  const dir = path.dirname(replayLogPath);
  await fs.mkdir(dir, { recursive: true, mode: SECURE_DIR_MODE });
  await fs.appendFile(replayLogPath, `${JSON.stringify(record)}\n`, { mode: SECURE_FILE_MODE });
}

function normalizeDeadLetterEntry(value: unknown): DeliveryDeadLetterEntry | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== "string" ||
    typeof obj.timestamp !== "number" ||
    typeof obj.source !== "string" ||
    typeof obj.reason !== "string" ||
    typeof obj.attempts !== "number" ||
    typeof obj.error !== "string"
  ) {
    return undefined;
  }

  const targetRaw = obj.target as Record<string, unknown> | undefined;
  if (!targetRaw || typeof targetRaw.channel !== "string" || typeof targetRaw.to !== "string") {
    return undefined;
  }

  const payloadRaw = obj.payload as Record<string, unknown> | undefined;
  const text = typeof payloadRaw?.text === "string" ? payloadRaw.text : "";
  const mediaRaw = Array.isArray(payloadRaw?.media) ? payloadRaw.media : [];
  const media: DeadLetterMediaMeta[] = mediaRaw
    .map((item): DeadLetterMediaMeta | undefined => {
      const m = item as Record<string, unknown>;
      if (typeof m.type !== "string" || typeof m.mimeType !== "string") {
        return undefined;
      }
      const result: DeadLetterMediaMeta = {
        type: m.type as OutboundMedia["type"],
        mimeType: m.mimeType,
      };
      if (typeof m.filename === "string") {
        result.filename = m.filename;
      }
      if (typeof m.sizeBytes === "number") {
        result.sizeBytes = m.sizeBytes;
      }
      if (typeof m.url === "string") {
        result.url = m.url;
      }
      return result;
    })
    .filter((item): item is DeadLetterMediaMeta => item !== undefined);

  return {
    id: obj.id,
    timestamp: obj.timestamp,
    source: obj.source,
    reason: obj.reason,
    taskId: typeof obj.taskId === "string" ? obj.taskId : undefined,
    attempts: obj.attempts,
    error: obj.error,
    target: {
      channel: targetRaw.channel as DeliveryTarget["channel"],
      to: targetRaw.to,
      accountId: typeof targetRaw.accountId === "string" ? targetRaw.accountId : undefined,
    },
    payload: {
      text,
      media,
    },
  };
}
