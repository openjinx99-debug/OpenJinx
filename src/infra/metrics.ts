import fs from "node:fs";
import path from "node:path";
import { resolveHomeDir } from "./home-dir.js";
import { createLogger } from "./logger.js";
import { SECURE_FILE_MODE } from "./security.js";

const logger = createLogger("metrics");

const METRICS_FILENAME = "metrics.jsonl";

/** A single agent turn metric entry. */
export interface TurnMetric {
  timestamp: number;
  sessionKey: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  durationMs: number;
  turnType: "chat" | "heartbeat" | "cron" | "compaction";
}

/** Aggregated usage summary over a set of metrics. */
export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  /** Percentage of input tokens served from cache (0-100). */
  cacheHitRate: number;
  /** Breakdown of turns by type. */
  turnsByType: Record<TurnMetric["turnType"], number>;
  /** Total number of turns. */
  totalTurns: number;
  /** Total duration across all turns. */
  totalDurationMs: number;
}

/** Resolve the metrics file path. */
export function getMetricsPath(): string {
  return path.join(resolveHomeDir(), METRICS_FILENAME);
}

/**
 * Append a turn metric to the JSONL file (fire-and-forget).
 * Writes are synchronous to avoid interleaving from concurrent calls.
 */
export function logTurnMetric(metric: TurnMetric): void {
  try {
    const filePath = getMetricsPath();
    const line = JSON.stringify(metric) + "\n";
    fs.appendFileSync(filePath, line, { mode: SECURE_FILE_MODE });
  } catch (err) {
    logger.warn(`Failed to write metric: ${err}`);
  }
}

/**
 * Read metrics from the JSONL file.
 * Optionally filter to entries since a given timestamp.
 */
export async function readMetrics(since?: number): Promise<TurnMetric[]> {
  const filePath = getMetricsPath();
  let data: string;
  try {
    data = await fs.promises.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const metrics: TurnMetric[] = [];
  for (const line of data.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line) as TurnMetric;
      if (since === undefined || entry.timestamp >= since) {
        metrics.push(entry);
      }
    } catch {
      // Skip malformed lines
      logger.debug(`Skipping malformed metrics line: ${line.slice(0, 80)}`);
    }
  }
  return metrics;
}

/** Compute an aggregated usage summary from a set of metrics. */
export function computeUsageSummary(metrics: TurnMetric[]): UsageSummary {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;
  let totalDurationMs = 0;
  const turnsByType: Record<TurnMetric["turnType"], number> = {
    chat: 0,
    heartbeat: 0,
    cron: 0,
    compaction: 0,
  };

  for (const m of metrics) {
    totalInputTokens += m.inputTokens;
    totalOutputTokens += m.outputTokens;
    totalCacheCreationTokens += m.cacheCreationTokens;
    totalCacheReadTokens += m.cacheReadTokens;
    totalDurationMs += m.durationMs;
    turnsByType[m.turnType] = (turnsByType[m.turnType] ?? 0) + 1;
  }

  // Cache hit rate: cache reads as a percentage of total input tokens
  // (input_tokens from the API already excludes cached tokens, so total
  // billable input = inputTokens + cacheCreationTokens + cacheReadTokens)
  const totalBillableInput = totalInputTokens + totalCacheCreationTokens + totalCacheReadTokens;
  const cacheHitRate =
    totalBillableInput > 0 ? (totalCacheReadTokens / totalBillableInput) * 100 : 0;

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheCreationTokens,
    totalCacheReadTokens,
    cacheHitRate,
    turnsByType,
    totalTurns: metrics.length,
    totalDurationMs,
  };
}
