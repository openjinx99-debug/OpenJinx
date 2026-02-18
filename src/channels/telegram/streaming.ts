import { createLogger } from "../../infra/logger.js";
import { markdownToTelegramHtml } from "./format.js";
import { fetchWithRetry, PARSE_ERR_RE, sendMessageTelegram } from "./send.js";

const logger = createLogger("telegram:stream");

/** Minimum interval between edits (ms) to avoid Telegram rate limits. */
const EDIT_THROTTLE_MS = 300;

/**
 * Stream writer that uses Telegram's "edit message" approach.
 * Sends an initial message, then progressively edits it as deltas arrive.
 */
export class TelegramStreamWriter {
  private buffer = "";
  private messageId: number | undefined;
  private lastEditAt = 0;
  private pendingEdit: ReturnType<typeof setTimeout> | undefined;
  /** Tracks in-flight send/edit started by a scheduled timeout. */
  private inflightOp: Promise<void> | undefined;

  constructor(
    private readonly botToken: string,
    private readonly chatId: string | number,
  ) {}

  /** Whether the buffer has any content (used to avoid overwriting deltas with final text). */
  hasContent(): boolean {
    return this.buffer.length > 0;
  }

  /** Append a text delta and schedule an edit. */
  sendDelta(text: string): void {
    this.buffer += text;
    this.scheduleEdit();
  }

  /** Finalize the message with the complete text. */
  async finalize(): Promise<void> {
    if (this.pendingEdit) {
      clearTimeout(this.pendingEdit);
      this.pendingEdit = undefined;
    }

    // Wait for any in-flight send/edit from a scheduled timeout to complete.
    // Without this, a race occurs: the timeout clears pendingEdit and starts
    // sendInitial() (async fetch in-flight), then finalize() sees no pendingEdit
    // and no messageId, so it calls sendInitial() again — producing a duplicate.
    if (this.inflightOp) {
      await this.inflightOp;
      this.inflightOp = undefined;
    }

    if (!this.messageId) {
      // Never sent an initial message — send the full thing
      await this.sendInitial();
      return;
    }

    await this.editMessage();
  }

  private scheduleEdit(): void {
    if (this.pendingEdit) {
      return;
    }

    const elapsed = Date.now() - this.lastEditAt;
    const delay = Math.max(0, EDIT_THROTTLE_MS - elapsed);

    this.pendingEdit = setTimeout(() => {
      this.pendingEdit = undefined;
      const op = (async () => {
        try {
          if (!this.messageId) {
            await this.sendInitial();
          } else {
            await this.editMessage();
          }
        } catch (err) {
          logger.error("Stream edit failed", err);
        }
      })();
      this.inflightOp = op;
    }, delay);
  }

  private async sendInitial(): Promise<void> {
    // Send the first message and capture its ID for subsequent edits
    const html = markdownToTelegramHtml(this.buffer);
    this.messageId = await sendMessageTelegram({
      botToken: this.botToken,
      chatId: this.chatId,
      text: html,
    });
    this.lastEditAt = Date.now();
  }

  private async editMessage(): Promise<void> {
    const html = markdownToTelegramHtml(this.buffer);
    const url = `https://api.telegram.org/bot${this.botToken}/editMessageText`;

    const resp = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        message_id: this.messageId,
        text: html,
        parse_mode: "HTML",
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      // Suppress "message is not modified" — expected during finalize when
      // the last throttled edit already pushed the same text.
      if (resp.status === 400 && body.includes("message is not modified")) {
        logger.debug("Edit skipped: message unchanged");
      } else if (resp.status === 400 && PARSE_ERR_RE.test(body)) {
        // HTML parse error — retry without parse_mode
        logger.warn("Edit HTML parse failed, retrying as plain text");
        await fetchWithRetry(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.chatId,
            message_id: this.messageId,
            text: this.buffer,
          }),
        });
      } else {
        logger.warn(`Edit failed: ${resp.status} ${body}`);
      }
    }

    this.lastEditAt = Date.now();
  }
}
