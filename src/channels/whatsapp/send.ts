import type { WhatsAppSocket } from "./session.js";
import { createLogger } from "../../infra/logger.js";
import { markdownToWhatsApp } from "./format.js";

const logger = createLogger("whatsapp:send");

export interface SendWhatsAppParams {
  socket: WhatsAppSocket;
  jid: string;
  text: string;
  /** Whether to convert markdown before sending. Defaults to true. */
  formatMarkdown?: boolean;
}

/**
 * Send a text message via WhatsApp.
 */
export async function sendMessageWhatsApp(params: SendWhatsAppParams): Promise<void> {
  const { socket, jid, text, formatMarkdown = true } = params;
  const formatted = formatMarkdown ? markdownToWhatsApp(text) : text;

  logger.debug(`Sending to ${jid} (${formatted.length} chars)`);
  await socket.sendMessage(jid, { text: formatted });
}
