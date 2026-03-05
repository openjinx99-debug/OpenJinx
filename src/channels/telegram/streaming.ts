import { createLogger } from "../../infra/logger.js";
import { markdownToTelegramHtml, markdownToTelegramChunks } from "./format.js";
import {
  PARSE_ERR_RE,
  sendMessageTelegram,
  getRateLimitWaitMs,
  setRateLimit,
  extractRetryAfter,
} from "./send.js";

const logger = createLogger("telegram:stream");

/** Minimum interval between edits (ms) to avoid Telegram rate limits. */
const EDIT_THROTTLE_MS = 2000;

/**
 * Telegram's hard limit is 4096 chars for message text.
 * We chunk at a much lower plain-text limit because HTML tags (bold, code,
 * blockquote, links) inflate the output significantly — sometimes 1.5–2x.
 * 2800 chars of plain text leaves plenty of headroom for HTML overhead.
 */
const CHUNK_PLAIN_TEXT_LIMIT = 2800;

/**
 * During streaming, we truncate the preview at this many plain-text chars.
 * Kept conservative since we can't predict HTML expansion precisely.
 */
const STREAM_PREVIEW_LIMIT = 2600;

/**
 * Stream writer that uses Telegram's "edit message" approach.
 * Sends an initial message, then progressively edits it as deltas arrive.
 * When content exceeds Telegram's message limit, finalizes the current message
 * and starts a new one for the overflow.
 *
 * Rate limit handling:
 * - Uses GLOBAL rate limit state shared across all stream writers and senders.
 * - Streaming edits are fire-and-forget — if a 429 hits, we skip and wait.
 * - Finalize is critical — if 429'd, we respect retry_after and retry.
 */
export class TelegramStreamWriter {
  private buffer = "";
  private messageId: number | undefined;
  private lastEditAt = 0;
  private pendingEdit: ReturnType<typeof setTimeout> | undefined;
  /** Tracks in-flight send/edit started by a scheduled timeout. */
  private inflightOp: Promise<void> | undefined;
  /** Prevents concurrent sendInitial calls from creating duplicate messages. */
  private sendingInitial = false;
  /** Message IDs of finalized overflow messages. */
  private overflowMessageIds: number[] = [];

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
    if (this.inflightOp) {
      await this.inflightOp;
      this.inflightOp = undefined;
    }

    // If we're rate-limited, wait for the cooldown before attempting finalize
    const waitMs = getRateLimitWaitMs(this.botToken);
    if (waitMs > 0) {
      logger.info(`Rate-limited — waiting ${Math.ceil(waitMs / 1000)}s before finalize`);
      await new Promise((resolve) => setTimeout(resolve, waitMs + 500)); // +500ms safety margin
    }

    // Use chunk-based sending for the final content to handle long messages properly
    const chunks = markdownToTelegramChunks(this.buffer, CHUNK_PLAIN_TEXT_LIMIT);

    if (chunks.length === 0) {
      return;
    }

    // Always use chunk HTML directly — never re-convert from buffer.
    // This ensures we respect the chunk boundaries.
    if (chunks.length === 1) {
      const html = chunks[0].html;
      if (this.messageId) {
        await this.editMessageFinal(html);
      } else {
        this.messageId = await sendMessageTelegram({
          botToken: this.botToken,
          chatId: this.chatId,
          text: html,
        });
      }
      return;
    }

    // Multiple chunks — edit/send the first, send rest as new messages
    if (this.messageId) {
      await this.editMessageFinal(chunks[0].html);
    } else {
      this.messageId = await sendMessageTelegram({
        botToken: this.botToken,
        chatId: this.chatId,
        text: chunks[0].html,
      });
    }

    // Send remaining chunks as new messages
    for (let i = 1; i < chunks.length; i++) {
      const msgId = await sendMessageTelegram({
        botToken: this.botToken,
        chatId: this.chatId,
        text: chunks[i].html,
      });
      if (msgId) {
        this.overflowMessageIds.push(msgId);
      }
    }
  }

  private scheduleEdit(): void {
    if (this.pendingEdit) {
      return;
    }

    // If rate-limited, don't even schedule
    if (getRateLimitWaitMs(this.botToken) > 0) {
      return;
    }

    // If there's already an in-flight operation, don't schedule another.
    // When the in-flight op completes, it will reschedule if needed.
    if (this.inflightOp) {
      return;
    }

    const elapsed = Date.now() - this.lastEditAt;
    const delay = Math.max(0, EDIT_THROTTLE_MS - elapsed);

    this.pendingEdit = setTimeout(() => {
      this.pendingEdit = undefined;

      // Double-check rate limit before executing
      if (getRateLimitWaitMs(this.botToken) > 0) {
        return;
      }

      // Don't start a new op if one is already in-flight
      if (this.inflightOp) {
        return;
      }

      const op = (async () => {
        try {
          if (!this.messageId && !this.sendingInitial) {
            await this.sendInitial();
          } else if (this.messageId) {
            await this.editMessageStreaming();
          }
          // If sendingInitial is true but messageId isn't set yet,
          // skip — another sendInitial is already in progress
        } catch (err) {
          logger.error("Stream edit failed", err);
        }
      })();
      this.inflightOp = op;
      // Clean up inflightOp when done, then reschedule if buffer has grown
      op.then(() => {
        this.inflightOp = undefined;
        // If buffer has grown since last edit, schedule another
        if (this.buffer.length > 0 && !this.pendingEdit) {
          this.scheduleEdit();
        }
      });
    }, delay);
  }

  private async sendInitial(): Promise<void> {
    // Guard against concurrent sendInitial calls
    if (this.sendingInitial) {
      return;
    }
    this.sendingInitial = true;

    try {
      // For streaming, we only show a truncated preview if the buffer is huge
      const previewText =
        this.buffer.length > STREAM_PREVIEW_LIMIT
          ? this.buffer.slice(0, STREAM_PREVIEW_LIMIT - 20) + "\n\n⏳ ..."
          : this.buffer;
      const html = markdownToTelegramHtml(previewText);
      this.messageId = await sendMessageTelegram({
        botToken: this.botToken,
        chatId: this.chatId,
        text: html,
      });
      this.lastEditAt = Date.now();
    } finally {
      this.sendingInitial = false;
    }
  }

  /**
   * Edit during streaming — fire-and-forget. If it fails (429 or otherwise),
   * we just skip. The next scheduled edit or finalize will catch up.
   * Now uses global rate limit state so ALL writers respect the same ban.
   */
  private async editMessageStreaming(): Promise<void> {
    const previewText =
      this.buffer.length > STREAM_PREVIEW_LIMIT
        ? this.buffer.slice(0, STREAM_PREVIEW_LIMIT - 20) + "\n\n⏳ ..."
        : this.buffer;
    const html = markdownToTelegramHtml(previewText);

    const url = `https://api.telegram.org/bot${this.botToken}/editMessageText`;

    const resp = await fetch(url, {
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
      if (resp.status === 429) {
        // Rate limited — record in GLOBAL state so all writers respect it
        const retryAfter = extractRetryAfter(body);
        setRateLimit(this.botToken, retryAfter);
        logger.warn(`Rate limited during streaming — suppressing edits for ${retryAfter}s`);
      } else if (resp.status === 400 && body.includes("message is not modified")) {
        // Expected — content hasn't changed enough
        logger.debug("Edit skipped: message unchanged");
      } else if (resp.status === 400 && PARSE_ERR_RE.test(body)) {
        // HTML parse error — try plain text (fire-and-forget)
        logger.warn("Edit HTML parse failed, retrying as plain text");
        const plainText =
          this.buffer.length > STREAM_PREVIEW_LIMIT
            ? this.buffer.slice(0, STREAM_PREVIEW_LIMIT - 20) + "\n\n⏳ ..."
            : this.buffer;
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.chatId,
            message_id: this.messageId,
            text: plainText,
          }),
        }).catch(() => {}); // Don't care if this fails during streaming
      } else {
        logger.warn(`Streaming edit failed: ${resp.status} — skipping`);
      }
    }

    this.lastEditAt = Date.now();
  }

  /**
   * Edit during finalize — this MUST succeed. If 429'd, we wait and retry.
   * Falls back to plain text if HTML parsing fails.
   * Falls back to sending a NEW message if edit keeps failing.
   * When falling back to a new message, deletes the orphaned streaming preview.
   */
  private async editMessageFinal(html: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/editMessageText`;
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Wait out any global rate limit before each attempt
      const waitMs = getRateLimitWaitMs(this.botToken);
      if (waitMs > 0) {
        logger.info(`Finalize waiting ${Math.ceil(waitMs / 1000)}s for rate limit`);
        await new Promise((resolve) => setTimeout(resolve, waitMs + 500));
      }

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          message_id: this.messageId,
          text: html,
          parse_mode: "HTML",
        }),
      });

      if (resp.ok) {
        this.lastEditAt = Date.now();
        return;
      }

      const body = await resp.text();

      if (resp.status === 429) {
        const retryAfter = extractRetryAfter(body);
        setRateLimit(this.botToken, retryAfter);
        logger.warn(
          `Finalize rate-limited — waiting ${retryAfter}s (attempt ${attempt + 1}/${maxAttempts})`,
        );
        continue; // Will wait at top of next iteration
      }

      if (resp.status === 400 && body.includes("message is not modified")) {
        logger.debug("Finalize edit skipped: message unchanged");
        return; // Content already correct
      }

      if (resp.status === 400 && PARSE_ERR_RE.test(body)) {
        // HTML parse error — retry as plain text
        logger.warn("Finalize HTML parse failed, retrying as plain text");
        const plainResp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.chatId,
            message_id: this.messageId,
            text: this.buffer,
          }),
        });
        if (plainResp.ok) {
          this.lastEditAt = Date.now();
          return;
        }
        // If plain text also fails, fall through to new message
        break;
      }

      logger.warn(`Finalize edit failed: ${resp.status} — ${body}`);
      break; // Don't retry on other errors
    }

    // Last resort: send as a new message, then delete the orphaned streaming preview
    logger.warn("Finalize edit exhausted retries — sending as new message");
    const orphanMessageId = this.messageId;
    try {
      this.messageId = await sendMessageTelegram({
        botToken: this.botToken,
        chatId: this.chatId,
        text: html,
      });
    } catch (err) {
      logger.error("Finalize fallback send also failed", err);
    }

    // Delete the orphaned streaming preview message
    if (orphanMessageId) {
      this.deleteMessage(orphanMessageId).catch((err) =>
        logger.warn("Failed to delete orphaned streaming message", err),
      );
    }
  }

  /** Delete a Telegram message (best-effort). */
  private async deleteMessage(messageId: number): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/deleteMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        message_id: messageId,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      logger.warn(`Delete message ${messageId} failed: ${resp.status} — ${body}`);
    }
  }
}
