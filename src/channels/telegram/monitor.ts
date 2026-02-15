import type { TelegramUpdate } from "./context.js";
import { createLogger } from "../../infra/logger.js";

const logger = createLogger("telegram:monitor");

const POLL_INTERVAL_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/**
 * Monitors Telegram via long polling with exponential backoff on errors.
 */
export class TelegramMonitor {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private backoffMs = POLL_INTERVAL_MS;
  private offset = 0;

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
    logger.info("Telegram monitor started");
    this.schedulePoll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
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
      } catch (err) {
        logger.warn(`Poll error, backing off ${this.backoffMs}ms`, err);
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
}
