import type { IncomingHttpHeaders } from "node:http";
import type { DispatchDeps } from "../../pipeline/dispatch.js";
import type { ChannelPlugin } from "../../types/channels.js";
import type { TelegramChannelConfig } from "../../types/config.js";
import type { ChatEvent, MsgContext, ReplyPayload } from "../../types/messages.js";
import type { TelegramUpdate } from "./context.js";
import { createLogger } from "../../infra/logger.js";
import { subscribeStream } from "../../pipeline/streaming.js";
import { telegramUpdateToContext, extractTelegramMedia } from "./context.js";
import { dispatchTelegramMessage } from "./dispatch.js";
import { markdownToTelegramChunks } from "./format.js";
import { downloadTelegramMedia, sendTelegramMedia } from "./media.js";
import { TelegramMonitor } from "./monitor.js";
import { sendMessageTelegram, startTypingLoop } from "./send.js";
import { TelegramStreamWriter } from "./streaming.js";
import {
  registerTelegramWebhook,
  deleteTelegramWebhook,
  parseTelegramWebhookRequest,
} from "./webhook.js";

const logger = createLogger("telegram:bot");

/**
 * Create a Telegram channel plugin that polls for updates and dispatches
 * messages through the Jinx pipeline.
 */
export function createTelegramChannel(
  telegramConfig: TelegramChannelConfig,
  deps: DispatchDeps,
): ChannelPlugin {
  const botToken = telegramConfig.botToken!;
  const streamingEnabled = telegramConfig.streaming !== false;

  let monitor: TelegramMonitor | undefined;
  const activeWriters = new Map<string, TelegramStreamWriter>();

  /** Core send logic shared by stream callbacks and channel.send(). */
  async function sendText(chatId: number, text: string): Promise<number | undefined> {
    const chunks = markdownToTelegramChunks(text, 4000);
    let lastMessageId: number | undefined;
    for (const chunk of chunks) {
      lastMessageId = await sendMessageTelegram({ botToken, chatId, text: chunk.html });
    }
    return lastMessageId;
  }

  async function handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    // Accept messages with text, caption, or media (photo/document/audio/video/voice)
    if (
      !msg?.text &&
      !msg?.caption &&
      !msg?.photo &&
      !msg?.document &&
      !msg?.audio &&
      !msg?.video &&
      !msg?.voice
    ) {
      return;
    }

    let ctx: MsgContext;
    try {
      ctx = telegramUpdateToContext(update);
    } catch (err) {
      logger.error("Failed to convert update to context", err);
      return;
    }

    // Download media buffers before dispatch
    if (msg && ctx.media && ctx.media.length > 0) {
      const { fileIds } = extractTelegramMedia(msg);
      for (let i = 0; i < ctx.media.length && i < fileIds.length; i++) {
        try {
          const buffer = await downloadTelegramMedia({ fileId: fileIds[i], botToken });
          ctx.media[i].buffer = buffer;
        } catch (err) {
          logger.warn(`Media download failed for file ${fileIds[i]}, continuing without: ${err}`);
        }
      }
    }

    const chatId = ctx.isGroup ? ctx.groupId! : ctx.senderId;
    logger.info(`Message from ${ctx.senderName} in chat ${chatId}`);

    // Subscribe to stream events BEFORE dispatch so we capture from the start
    if (streamingEnabled) {
      const writer = new TelegramStreamWriter(botToken, Number(chatId));
      activeWriters.set(ctx.sessionKey, writer);

      const unsub = subscribeStream(ctx.sessionKey, (event: ChatEvent) => {
        if (event.type === "delta") {
          writer.sendDelta(event.text);
        } else if (event.type === "final") {
          writer.finalize().catch((err) => logger.error("Stream finalize failed", err));
          activeWriters.delete(ctx.sessionKey);
          unsub();
        } else if (event.type === "aborted") {
          activeWriters.delete(ctx.sessionKey);
          unsub();
        }
      });
    } else {
      // No streaming — subscribe only for the final message
      const unsub = subscribeStream(ctx.sessionKey, (event: ChatEvent) => {
        if (event.type === "final" && event.text) {
          sendText(Number(chatId), event.text).catch((err) => logger.error("Send failed", err));
          unsub();
        } else if (event.type === "aborted") {
          unsub();
        }
      });
    }

    // Show "typing..." indicator while the agent is thinking
    const stopTyping = startTypingLoop(botToken, Number(chatId));

    try {
      await dispatchTelegramMessage(ctx, deps);
    } catch (err) {
      logger.error("Dispatch failed", err);
    } finally {
      stopTyping();
    }
  }

  const useWebhook = telegramConfig.mode === "webhook";

  return {
    id: "telegram",
    name: "Telegram",
    capabilities: {
      markdown: true,
      images: true,
      audio: true,
      video: true,
      documents: true,
      reactions: false,
      editing: true,
      streaming: true,
      maxTextLength: 4096,
    },

    async start() {
      if (useWebhook) {
        await registerTelegramWebhook(telegramConfig);
        logger.info("Telegram channel started (webhook mode)");
      } else {
        monitor = new TelegramMonitor(botToken, handleUpdate);
        monitor.start();
        logger.info("Telegram channel started (polling mode)");
      }
    },

    async stop() {
      if (useWebhook) {
        await deleteTelegramWebhook(botToken).catch((err) =>
          logger.warn("Failed to delete webhook on stop", err),
        );
      } else {
        monitor?.stop();
        monitor = undefined;
      }

      // Finalize any active stream writers
      for (const [key, writer] of activeWriters) {
        await writer.finalize().catch((err) => logger.error("Finalize on stop failed", err));
        activeWriters.delete(key);
      }

      logger.info("Telegram channel stopped");
    },

    async send(to: string, payload: ReplyPayload): Promise<string | undefined> {
      if (!payload.text && !payload.media?.length) {
        return undefined;
      }

      let lastMessageId: number | undefined;
      if (payload.text) {
        lastMessageId = await sendText(Number(to), payload.text);
      }

      // Send media attachments (documents, images, etc.)
      if (payload.media) {
        for (const item of payload.media) {
          if (item.buffer) {
            await sendTelegramMedia({
              chatId: to,
              botToken,
              buffer: Buffer.from(item.buffer),
              type: item.type,
              filename: item.filename,
              caption: item.caption,
            });
          }
        }
      }

      return lastMessageId ? String(lastMessageId) : undefined;
    },

    onStreamEvent(sessionKey: string, event: ChatEvent) {
      const writer = activeWriters.get(sessionKey);
      if (!writer) {
        return;
      }
      if (event.type === "delta") {
        writer.sendDelta(event.text);
      } else if (event.type === "final") {
        writer.finalize().catch((err) => logger.error("Stream finalize failed", err));
        activeWriters.delete(sessionKey);
      }
    },

    isReady() {
      return useWebhook || monitor !== undefined;
    },

    /** Handle an incoming webhook request from the HTTP server. */
    async handleWebhookRequest(
      body: string,
      headers: IncomingHttpHeaders,
    ): Promise<{ status: number; body: string }> {
      if (!useWebhook) {
        return { status: 400, body: JSON.stringify({ error: "Not in webhook mode" }) };
      }

      const update = parseTelegramWebhookRequest(body, headers, telegramConfig.secretToken);
      if (!update) {
        return { status: 403, body: JSON.stringify({ error: "Invalid request" }) };
      }

      // Process asynchronously — Telegram expects a fast 200 OK
      handleUpdate(update).catch((err) => logger.error("Webhook update handler error", err));

      return { status: 200, body: JSON.stringify({ ok: true }) };
    },
  };
}
