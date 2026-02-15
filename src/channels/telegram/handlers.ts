import type { MsgContext } from "../../types/messages.js";
import type { TelegramUpdate } from "./context.js";
import { createLogger } from "../../infra/logger.js";
import { telegramUpdateToContext } from "./context.js";

const logger = createLogger("telegram:handlers");

/**
 * Register message handlers on a Telegram bot instance.
 * Converts raw updates to MsgContext and forwards to the callback.
 */
export function registerTelegramHandlers(
  bot: { onMessage(handler: (update: unknown) => void | Promise<void>): void },
  onMessage: (ctx: MsgContext) => Promise<void>,
): void {
  bot.onMessage(async (rawUpdate) => {
    try {
      const update = rawUpdate as TelegramUpdate;
      if (!update.message?.text) {
        return;
      }

      const ctx = telegramUpdateToContext(update);
      await onMessage(ctx);
    } catch (err) {
      logger.error("Error handling Telegram message", err);
    }
  });
}
