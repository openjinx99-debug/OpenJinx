import type { TelegramUpdate } from "./context.js";
import { createLogger } from "../../infra/logger.js";

const logger = createLogger("telegram:monitor");

const POLL_INTERVAL_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const ERROR_LOG_SUMMARY_INTERVAL_MS = 60_000;

/**
 * Monitors Telegram via long polling with exponential backoff on errors.
 */
export class TelegramMonitor {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private backoffMs = POLL_INTERVAL_MS;
  private offset = 0;
  private consecutiveErrors = 0;
  private firstErrorAt = 0;
  private lastErrorLogAt = 0;
  private suppressedErrorLogs = 0;
  private lastErrorSignature = "";

  constructor(
    private readonly botToken: string,
    private readonly onUpdate: (update: TelegramUpdate) => void | Promise<void>,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.backoffMs = POLL_INTERVAL_MS;
    this.consecutiveErrors = 0;
    this.firstErrorAt = 0;
    this.lastErrorLogAt = 0;
    this.suppressedErrorLogs = 0;
    this.lastErrorSignature = "";
    logger.info("Telegram monitor started");
    this.schedulePoll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.consecutiveErrors = 0;
    this.firstErrorAt = 0;
    this.lastErrorLogAt = 0;
    this.suppressedErrorLogs = 0;
    this.lastErrorSignature = "";
    logger.info("Telegram monitor stopped");
  }

  private schedulePoll(): void {
    if (!this.running) {
      return;
    }

    this.timer = setTimeout(async () => {
      try {
        await this.poll();
        this.backoffMs = POLL_INTERVAL_MS; // reset on success
        this.logRecoveryIfNeeded();
      } catch (err) {
        this.logPollError(err);
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      }
      this.schedulePoll();
    }, this.backoffMs);

    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/getUpdates`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset: this.offset,
        timeout: 25,
        allowed_updates: ["message"],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`getUpdates failed: ${resp.status} ${body}`);
    }

    const json = (await resp.json()) as { ok: boolean; result: TelegramUpdate[] };
    if (!json.ok) {
      throw new Error("getUpdates response not ok");
    }

    for (const update of json.result) {
      this.offset = update.update_id + 1;
      try {
        await this.onUpdate(update);
      } catch (err) {
        logger.error(`Error handling update ${update.update_id}`, err);
      }
    }
  }

  private logRecoveryIfNeeded(): void {
    if (this.consecutiveErrors === 0) {
      return;
    }
    const durationMs = this.firstErrorAt > 0 ? Date.now() - this.firstErrorAt : 0;
    const summary =
      this.suppressedErrorLogs > 0
        ? ` (suppressed ${this.suppressedErrorLogs} repeated errors)`
        : "";
    logger.info(
      `Telegram polling recovered after ${this.consecutiveErrors} error(s) over ${Math.round(durationMs / 1000)}s${summary}`,
    );
    this.consecutiveErrors = 0;
    this.firstErrorAt = 0;
    this.lastErrorLogAt = 0;
    this.suppressedErrorLogs = 0;
    this.lastErrorSignature = "";
  }

  private logPollError(err: unknown): void {
    const now = Date.now();
    const signature = normalizeError(err);
    this.consecutiveErrors++;
    if (this.firstErrorAt === 0) {
      this.firstErrorAt = now;
    }

    const signatureChanged = signature !== this.lastErrorSignature;
    const shouldLog =
      this.consecutiveErrors === 1 ||
      signatureChanged ||
      now - this.lastErrorLogAt >= ERROR_LOG_SUMMARY_INTERVAL_MS;
    if (!shouldLog) {
      this.suppressedErrorLogs++;
      return;
    }

    const summary =
      this.suppressedErrorLogs > 0
        ? ` (suppressed ${this.suppressedErrorLogs} repeated errors)`
        : "";
    logger.warn(
      `Poll error, backing off ${this.backoffMs}ms (attempt ${this.consecutiveErrors}): ${signature}${summary}`,
    );
    this.lastErrorLogAt = now;
    this.suppressedErrorLogs = 0;
    this.lastErrorSignature = signature;
  }
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name || "Error";
    const message = err.message || "unknown";
    return `${name}: ${message}`;
  }
  return String(err);
}
