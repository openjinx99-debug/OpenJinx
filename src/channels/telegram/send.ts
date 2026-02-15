import { createLogger } from "../../infra/logger.js";

export { fetchWithRetry } from "../../infra/fetch-retry.js";

const logger = createLogger("telegram:send");

/** Matches Telegram 400 errors caused by malformed HTML entities. */
export const PARSE_ERR_RE = /can't parse entities|parse entities|find end of the entity/i;

export interface SendTelegramParams {
  botToken: string;
  chatId: string | number;
  text: string;
  parseMode?: string;
}

/**
 * Send a text message to a Telegram chat via the Bot API.
 * Returns the message_id of the sent message.
 *
 * When Telegram rejects malformed HTML (400 matching PARSE_ERR_RE),
 * retries without parse_mode so the message still delivers as plain text.
 */
export async function sendMessageTelegram(params: SendTelegramParams): Promise<number> {
  const { botToken, chatId, text, parseMode = "HTML" } = params;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  logger.debug(`Sending to chat ${chatId} (${text.length} chars)`);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();

    // If HTML parse error, retry without parse_mode
    if (resp.status === 400 && PARSE_ERR_RE.test(body)) {
      logger.warn("HTML parse failed, retrying as plain text");
      const retryResp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!retryResp.ok) {
        const retryBody = await retryResp.text();
        logger.error(`Plain text retry failed ${retryResp.status}: ${retryBody}`);
        throw new Error(`Telegram sendMessage failed: ${retryResp.status}`);
      }
      const retryJson = (await retryResp.json()) as { ok: boolean; result: { message_id: number } };
      return retryJson.result.message_id;
    }

    logger.error(`Telegram API error ${resp.status}: ${body}`);
    throw new Error(`Telegram sendMessage failed: ${resp.status}`);
  }

  const json = (await resp.json()) as { ok: boolean; result: { message_id: number } };
  return json.result.message_id;
}

/**
 * Send a "typing" chat action indicator to a Telegram chat.
 * Telegram auto-expires the indicator after ~5 seconds.
 */
export async function sendTypingIndicator(
  botToken: string,
  chatId: string | number,
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendChatAction`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });

  if (!resp.ok) {
    logger.debug(`Typing indicator failed: ${resp.status}`);
  }
}

/** Typing indicator refresh interval (Telegram expires after ~5s). */
const TYPING_REFRESH_MS = 4000;

/**
 * Start a repeating typing indicator. Returns a stop function.
 * Sends immediately, then refreshes every 4 seconds.
 */
export function startTypingLoop(botToken: string, chatId: string | number): () => void {
  // Fire immediately
  sendTypingIndicator(botToken, chatId).catch((err) =>
    logger.debug("Typing indicator failed", err),
  );

  const timer = setInterval(() => {
    sendTypingIndicator(botToken, chatId).catch((err) =>
      logger.debug("Typing indicator failed", err),
    );
  }, TYPING_REFRESH_MS);

  return () => clearInterval(timer);
}
