import { Command } from "commander";
import { createWhatsAppSession } from "../../channels/whatsapp/session.js";
import { sendMessageTelegram } from "../../channels/telegram/send.js";
import { sendMessageWhatsApp } from "../../channels/whatsapp/send.js";
import { loadAndValidateConfig } from "../../config/validation.js";
import type { DeliveryDeadLetterEntry, DeadLetterReplayRecord } from "../../delivery/dead-letter.js";
import {
  appendDeadLetterReplayRecord,
  getDeadLetterPaths,
  readDeadLetterEntries,
  readDeadLetterReplayRecords,
  summarizeDeadLetters,
} from "../../delivery/dead-letter.js";
import { expandTilde } from "../../infra/home-dir.js";
import { createLogger } from "../../infra/logger.js";
import { logProductTelemetry } from "../../infra/product-telemetry.js";
import { chunkText } from "../../markdown/chunk.js";

const logger = createLogger("cli:delivery");

const DEFAULT_STATUS_HOURS = 24;
const DEFAULT_LIST_LIMIT = 20;
const WHATSAPP_MAX_CHARS = 65_000;
const DEFAULT_REPLAY_TIMEOUT_MS = 30_000;

export const deliveryCommand = new Command("delivery")
  .description("Inspect dead-letter delivery failures and manually replay messages")
  .addCommand(
    new Command("status")
      .description("Show dead-letter summary (monitor view)")
      .option("--since-hours <hours>", "lookback window in hours", String(DEFAULT_STATUS_HOURS))
      .option("--json", "output JSON")
      .action(async (opts: { sinceHours?: string; json?: boolean }) => {
        await runStatusAction(opts);
      }),
  )
  .addCommand(
    new Command("monitor")
      .description("Alias for delivery status")
      .option("--since-hours <hours>", "lookback window in hours", String(DEFAULT_STATUS_HOURS))
      .option("--json", "output JSON")
      .action(async (opts: { sinceHours?: string; json?: boolean }) => {
        await runStatusAction(opts);
      }),
  )
  .addCommand(
    new Command("list")
      .description("List dead-letter entries")
      .option("--limit <n>", "max entries to show", String(DEFAULT_LIST_LIMIT))
      .option("--since-hours <hours>", "optional lookback window in hours")
      .option("--json", "output JSON")
      .action(async (opts: { limit?: string; sinceHours?: string; json?: boolean }) => {
        const limit = parsePositiveInt(opts.limit, "limit");
        const sinceHours =
          opts.sinceHours !== undefined ? parsePositiveInt(opts.sinceHours, "since-hours") : undefined;
        if (limit === undefined || (opts.sinceHours !== undefined && sinceHours === undefined)) {
          process.exitCode = 1;
          return;
        }

        const since = sinceHours !== undefined ? Date.now() - sinceHours * 60 * 60 * 1000 : undefined;
        const entries = await readDeadLetterEntries({ since, limit });
        const replayRecords = await readDeadLetterReplayRecords();
        const replayedSuccess = new Set(
          replayRecords.filter((r) => r.status === "success").map((r) => r.deadLetterId),
        );

        if (opts.json) {
          console.log(
            JSON.stringify(
              entries.map((entry) => ({
                ...entry,
                replayed: replayedSuccess.has(entry.id),
              })),
              null,
              2,
            ),
          );
          return;
        }

        if (entries.length === 0) {
          console.log("No dead-letter entries found.");
          return;
        }

        for (const entry of entries) {
          const replayTag = replayedSuccess.has(entry.id) ? " replayed" : "";
          console.log(
            `${entry.id}${replayTag} | ${formatTimestamp(entry.timestamp)} | ${entry.source} -> ${entry.target.channel}:${entry.target.to} | reason=${entry.reason} | error=${entry.error}`,
          );
        }
      }),
  )
  .addCommand(
    new Command("replay")
      .description("Replay a dead-letter entry by ID (manual operator action)")
      .argument("<deadLetterId>", "dead-letter ID (full ID or unique prefix)")
      .option("--dry-run", "preview replay payload without sending")
      .option("--force", "replay even if already replayed successfully")
      .option(
        "--timeout-ms <ms>",
        "WhatsApp connect timeout in milliseconds",
        String(DEFAULT_REPLAY_TIMEOUT_MS),
      )
      .action(async (deadLetterId: string, opts: { dryRun?: boolean; force?: boolean; timeoutMs?: string }) => {
        const timeoutMs = parsePositiveInt(opts.timeoutMs, "timeout-ms");
        if (timeoutMs === undefined) {
          process.exitCode = 1;
          return;
        }

        const entries = await readDeadLetterEntries();
        let entry: DeliveryDeadLetterEntry | undefined;
        try {
          entry = findDeadLetterEntry(entries, deadLetterId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(msg);
          process.exitCode = 1;
          return;
        }
        if (!entry) {
          console.error(`Dead-letter entry not found: ${deadLetterId}`);
          process.exitCode = 1;
          return;
        }

        const replayRecords = await readDeadLetterReplayRecords();
        const alreadySucceeded = replayRecords.some(
          (record) => record.deadLetterId === entry.id && record.status === "success",
        );
        if (alreadySucceeded && !opts.force) {
          const msg =
            `Dead-letter ${entry.id} already replayed successfully. ` +
            `Use --force to replay again.`;
          console.error(msg);
          await appendDeadLetterReplayRecord(
            buildReplayRecord(entry, "skipped", msg, opts.force),
          ).catch((err) => logger.warn(`Failed to append replay record: ${err}`));
          logReplayTelemetry("dead_letter_replay_skipped", entry, { reason: "already-replayed" });
          process.exitCode = 1;
          return;
        }

        const replayText = buildReplayText(entry);
        if (opts.dryRun) {
          console.log(
            JSON.stringify(
              {
                mode: "dry-run",
                deadLetterId: entry.id,
                target: entry.target,
                source: entry.source,
                reason: entry.reason,
                textPreview: replayText.slice(0, 500),
                mediaMetadataCount: entry.payload.media.length,
              },
              null,
              2,
            ),
          );
          await appendDeadLetterReplayRecord(buildReplayRecord(entry, "dry-run", undefined, opts.force));
          logReplayTelemetry("dead_letter_replay_dry_run", entry, { forced: Boolean(opts.force) });
          return;
        }

        logReplayTelemetry("dead_letter_replay_requested", entry, { forced: Boolean(opts.force) });

        let replayError: string | undefined;
        try {
          const config = await loadAndValidateConfig();
          await replayDeadLetterEntry(entry, replayText, config, timeoutMs);
          await appendDeadLetterReplayRecord(buildReplayRecord(entry, "success", undefined, opts.force));
          logReplayTelemetry("dead_letter_replay_succeeded", entry, { forced: Boolean(opts.force) });
          console.log(`Replayed dead-letter ${entry.id} to ${entry.target.channel}:${entry.target.to}`);
        } catch (err) {
          replayError = err instanceof Error ? err.message : String(err);
          await appendDeadLetterReplayRecord(buildReplayRecord(entry, "failed", replayError, opts.force));
          logReplayTelemetry("dead_letter_replay_failed", entry, {
            forced: Boolean(opts.force),
            error: replayError,
          });
          console.error(`Replay failed for ${entry.id}: ${replayError}`);
          process.exitCode = 1;
        }
      }),
  );

function parsePositiveInt(raw: string | undefined, fieldName: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`Invalid --${fieldName} value: ${raw}. Expected a positive integer.`);
    return undefined;
  }
  return value;
}

async function runStatusAction(opts: { sinceHours?: string; json?: boolean }): Promise<void> {
  const sinceHours = parsePositiveInt(opts.sinceHours, "since-hours");
  if (sinceHours === undefined) {
    process.exitCode = 1;
    return;
  }
  const since = Date.now() - sinceHours * 60 * 60 * 1000;
  const entries = await readDeadLetterEntries({ since });
  const summary = summarizeDeadLetters(entries);

  logProductTelemetry({
    area: "delivery",
    event: "dead_letter_monitor_snapshot",
    sinceHours,
    total: summary.total,
    bySource: summary.bySource,
    byChannel: summary.byChannel,
  });

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          paths: getDeadLetterPaths(),
          sinceHours,
          summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Dead-letter files: ${getDeadLetterPaths().join(", ")}`);
  console.log(`Window: last ${sinceHours} hour(s)`);
  console.log(`Total dead letters: ${summary.total}`);
  if (summary.total === 0) {
    return;
  }
  console.log(`Oldest: ${formatTimestamp(summary.oldestTimestamp)}`);
  console.log(`Latest: ${formatTimestamp(summary.latestTimestamp)}`);
  console.log(`By source: ${formatCounts(summary.bySource)}`);
  console.log(`By channel: ${formatCounts(summary.byChannel)}`);
  console.log(`By reason: ${formatCounts(summary.byReason)}`);
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) {
    return "n/a";
  }
  return new Date(ts).toISOString();
}

function formatCounts(counts: Record<string, number>): string {
  const items = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (items.length === 0) {
    return "none";
  }
  return items.map(([key, value]) => `${key}:${value}`).join(", ");
}

function findDeadLetterEntry(
  entries: DeliveryDeadLetterEntry[],
  identifier: string,
): DeliveryDeadLetterEntry | undefined {
  const exact = entries.find((entry) => entry.id === identifier);
  if (exact) {
    return exact;
  }
  const prefixMatches = entries.filter((entry) => entry.id.startsWith(identifier));
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }
  if (prefixMatches.length > 1) {
    throw new Error(`Dead-letter ID prefix is ambiguous: ${identifier}`);
  }
  return undefined;
}

function buildReplayText(entry: DeliveryDeadLetterEntry): string {
  const base =
    entry.payload.text.trim().length > 0
      ? entry.payload.text
      : `[Replay note] Original dead-letter payload had no text body.`;
  const mediaCount = entry.payload.media.length;
  if (mediaCount === 0) {
    return base;
  }
  return (
    `${base}\n\n` +
    `[Replay note] ${mediaCount} attachment metadata item(s) were logged, ` +
    `but binary attachment content is not persisted in dead-letter logs and was not replayed.`
  );
}

function buildReplayRecord(
  entry: DeliveryDeadLetterEntry,
  status: DeadLetterReplayRecord["status"],
  error?: string,
  forced?: boolean,
): DeadLetterReplayRecord {
  return {
    timestamp: Date.now(),
    deadLetterId: entry.id,
    status,
    channel: entry.target.channel,
    to: entry.target.to,
    error,
    forced,
  };
}

function logReplayTelemetry(
  event: string,
  entry: DeliveryDeadLetterEntry,
  metadata?: Record<string, unknown>,
): void {
  logProductTelemetry({
    area: "delivery",
    event,
    deadLetterId: entry.id,
    source: entry.source,
    reason: entry.reason,
    channel: entry.target.channel,
    to: entry.target.to,
    ...metadata,
  });
}

async function replayDeadLetterEntry(
  entry: DeliveryDeadLetterEntry,
  text: string,
  config: Awaited<ReturnType<typeof loadAndValidateConfig>>,
  timeoutMs: number,
): Promise<void> {
  switch (entry.target.channel) {
    case "telegram":
      await replayToTelegram(entry.target.to, text, config.channels.telegram);
      return;
    case "whatsapp":
      await replayToWhatsApp(entry.target.to, text, config.channels.whatsapp, timeoutMs);
      return;
    default:
      throw new Error(`Replay unsupported for channel "${entry.target.channel}"`);
  }
}

async function replayToTelegram(
  to: string,
  text: string,
  telegramConfig: Awaited<ReturnType<typeof loadAndValidateConfig>>["channels"]["telegram"],
): Promise<void> {
  if (!telegramConfig.enabled || !telegramConfig.botToken) {
    throw new Error("Telegram channel is not enabled or bot token is missing in config.");
  }
  const chunks = chunkText(text, 4000);
  for (const chunk of chunks) {
    await sendMessageTelegram({
      botToken: telegramConfig.botToken,
      chatId: to,
      text: chunk,
    });
  }
}

async function replayToWhatsApp(
  to: string,
  text: string,
  whatsappConfig: Awaited<ReturnType<typeof loadAndValidateConfig>>["channels"]["whatsapp"],
  timeoutMs: number,
): Promise<void> {
  if (!whatsappConfig.enabled) {
    throw new Error("WhatsApp channel is not enabled in config.");
  }
  const authDir = expandTilde(whatsappConfig.authDir ?? "~/.jinx/whatsapp-auth");
  const session = await createWhatsAppSession(
    authDir,
    {
      onMessage: () => {},
      onConnectionUpdate: () => {},
    },
    whatsappConfig.browserName,
  );
  try {
    await waitForWhatsAppReady(session.socket, timeoutMs);
    const chunks = chunkText(text, WHATSAPP_MAX_CHARS);
    for (const chunk of chunks) {
      await sendMessageWhatsApp({
        socket: session.socket,
        jid: to,
        text: chunk,
        formatMarkdown: false,
      });
    }
  } finally {
    session.cleanup();
  }
}

async function waitForWhatsAppReady(
  socket: { isConnected: boolean },
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (!socket.isConnected) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for WhatsApp connection (${timeoutMs}ms).`);
    }
    await sleep(250);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
