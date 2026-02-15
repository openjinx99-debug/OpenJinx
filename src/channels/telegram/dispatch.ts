import type { DispatchDeps } from "../../pipeline/dispatch.js";
import type { MsgContext, ReplyPayload } from "../../types/messages.js";
import { createLogger } from "../../infra/logger.js";
import { dispatchInboundMessage } from "../../pipeline/dispatch.js";
import { checkTelegramAccess } from "./access.js";

const logger = createLogger("telegram:dispatch");

/**
 * Dispatch a Telegram message through the unified pipeline.
 * Checks access control before forwarding to the core dispatch.
 */
export async function dispatchTelegramMessage(
  ctx: MsgContext,
  deps: DispatchDeps,
): Promise<ReplyPayload> {
  const chatId = Number(ctx.isGroup ? ctx.groupId : ctx.senderId);
  const telegramCfg = deps.config.channels.telegram;

  const allowed = checkTelegramAccess({
    chatId,
    isGroup: ctx.isGroup,
    dmPolicy: telegramCfg.dmPolicy ?? "open",
    groupPolicy: telegramCfg.groupPolicy,
    allowedChatIds: telegramCfg.allowedChatIds,
  });

  if (!allowed) {
    logger.warn(`Access denied for chat ${chatId}`);
    return { text: "Access denied." };
  }

  return dispatchInboundMessage(ctx, deps);
}
