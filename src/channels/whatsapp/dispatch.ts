import type { DispatchDeps } from "../../pipeline/dispatch.js";
import type { MsgContext, ReplyPayload } from "../../types/messages.js";
import { createLogger } from "../../infra/logger.js";
import { dispatchInboundMessage } from "../../pipeline/dispatch.js";
import { checkWhatsAppAccess } from "./access.js";

const logger = createLogger("whatsapp:dispatch");

/**
 * Dispatch a WhatsApp message through the unified pipeline.
 * Checks access control before forwarding to the core dispatch.
 */
export async function dispatchWhatsAppMessage(
  ctx: MsgContext,
  deps: DispatchDeps,
): Promise<ReplyPayload> {
  const jid = ctx.isGroup ? ctx.groupId! : ctx.senderId;
  const whatsappCfg = deps.config.channels.whatsapp;

  const allowed = checkWhatsAppAccess({
    jid,
    isGroup: ctx.isGroup,
    dmPolicy: whatsappCfg.dmPolicy ?? "open",
    groupPolicy: whatsappCfg.groupPolicy,
    allowFrom: whatsappCfg.allowFrom,
  });

  if (!allowed) {
    logger.warn(`Access denied for JID ${jid}`);
    return { text: "Access denied." };
  }

  return dispatchInboundMessage(ctx, deps);
}
