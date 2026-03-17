import { createLogger } from "../../infra/logger.js";

export { fetchWithRetry } from "../../infra/fetch-retry.js";

const logger = createLogger("telegram:send");

/** Matches Telegram 400 errors caused by malformed HTML entities. */
export const PARSE_ERR_RE = /can't parse entities|parse entities|find end of the entity/i;

// ──────────────────────────────────────────────
// Global per-bot rate limit tracker
// ──────────────────────────────────────────────

/**
 * Maps botToken → timestamp (ms) until which we're rate-limited.
 * Shared across ALL callers: sendMessageTelegram, TelegramStreamWriter,
 * sendTypingIndicator, etc. When Telegram 429s any request, every
 * subsequent request for that bot waits.
 */
const globalRateLimitUntil = new Map<string, number>();

/**
 * Maximum retry_after we'll honour from Telegram (5 minutes).
 * Telegram sometimes returns absurd values (55 000 s) when a bot is in a
 * 429 storm.  Capping prevents a single bad response from blocking the bot
 * for hours after the storm passes.
 */
const MAX_RATE_LIMIT_SECONDS = 300;

/** Check if a bot is currently rate-limited. Returns ms to wait, or 0. */
export function getRateLimitWaitMs(botToken: string): number {
  const until = globalRateLimitUntil.get(botToken) ?? 0;
  const wait = until - Date.now();
  return wait > 0 ? wait : 0;
}

/** Record a rate limit for a bot. Caps at MAX_RATE_LIMIT_SECONDS to avoid long bans from 429 storms. */
export function setRateLimit(botToken: string, retryAfterSeconds: number): void {
  const capped = Math.min(retryAfterSeconds, MAX_RATE_LIMIT_SECONDS);
  if (capped < retryAfterSeconds) {
    logger.warn(`Telegram retry_after=${retryAfterSeconds}s exceeds cap, clamping to ${capped}s`);
  }
  const until = Date.now() + capped * 1000;
  const existing = globalRateLimitUntil.get(botToken) ?? 0;
  // Only extend, never shorten
  if (until > existing) {
    globalRateLimitUntil.set(botToken, until);
    logger.warn(`Global rate limit set for ${capped}s (until ${new Date(until).toISOString()})`);
  }
}

/** Extract retry_after seconds from a Telegram 429 response body. */
export function extractRetryAfter(body: string): number {
  try {
    const parsed = JSON.parse(body);
    return parsed?.parameters?.retry_after ?? 30;
  } catch {
    return 30; // Default to 30s if we can't parse
  }
}

/** Wait out any active rate limit for this bot. */
async function waitForRateLimit(botToken: string): Promise<void> {
  const waitMs = getRateLimitWaitMs(botToken);
  if (waitMs > 0) {
    logger.info(`Waiting ${Math.ceil(waitMs / 1000)}s for rate limit to expire`);
    await new Promise((resolve) => setTimeout(resolve, waitMs + 500)); // +500ms safety margin
  }
}

// ──────────────────────────────────────────────

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
 * Handles 429 rate limits: waits for retry_after and retries (up to 3 attempts).
 * When Telegram rejects malformed HTML (400 matching PARSE_ERR_RE),
 * retries without parse_mode so the message still delivers as plain text.
 */
export async function sendMessageTelegram(params: SendTelegramParams): Promise<number> {
  const { botToken, chatId, text, parseMode = "HTML" } = params;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const maxAttempts = 3;

  logger.debug(`Sending to chat ${chatId} (${text.length} chars)`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Wait out any existing global rate limit before attempting
    await waitForRateLimit(botToken);

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    });

    if (resp.ok) {
      const json = (await resp.json()) as { ok: boolean; result: { message_id: number } };
      return json.result.message_id;
    }

    const body = await resp.text();

    // 429 — rate limited. Record globally (capped), wait, retry.
    if (resp.status === 429) {
      const retryAfter = extractRetryAfter(body);
      setRateLimit(botToken, retryAfter);
      const actualWait = Math.ceil(getRateLimitWaitMs(botToken) / 1000);
      logger.warn(
        `Rate limited on send — waiting ${actualWait}s (attempt ${attempt + 1}/${maxAttempts})`,
      );
      // waitForRateLimit at the top of the next iteration will handle the wait
      continue;
    }

    // If HTML parse error, retry without parse_mode (no rate limit issue)
    if (resp.status === 400 && PARSE_ERR_RE.test(body)) {
      logger.warn("HTML parse failed, retrying as plain text");
      await waitForRateLimit(botToken);
      const retryResp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!retryResp.ok) {
        const retryBody = await retryResp.text();
        if (retryResp.status === 429) {
          const retryAfter = extractRetryAfter(retryBody);
          setRateLimit(botToken, retryAfter);
          continue; // Retry from the top
        }
        logger.error(`Plain text retry failed ${retryResp.status}: ${retryBody}`);
        throw new Error(`Telegram sendMessage failed: ${retryResp.status}`);
      }
      const retryJson = (await retryResp.json()) as { ok: boolean; result: { message_id: number } };
      return retryJson.result.message_id;
    }

    logger.error(`Telegram API error ${resp.status}: ${body}`);
    throw new Error(`Telegram sendMessage failed: ${resp.status}`);
  }

  // Exhausted all attempts — still rate limited
  logger.error(`sendMessageTelegram exhausted ${maxAttempts} attempts — still rate limited`);
  throw new Error(`Telegram sendMessage failed: rate limited after ${maxAttempts} attempts`);
}

/**
 * Send a "typing" chat action indicator to a Telegram chat.
 * Telegram auto-expires the indicator after ~5 seconds.
 * Respects global rate limit — silently skips if rate-limited.
 */
export async function sendTypingIndicator(
  botToken: string,
  chatId: string | number,
): Promise<void> {
  // Don't even try if we're rate-limited
  if (getRateLimitWaitMs(botToken) > 0) {
    return;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendChatAction`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });

  if (!resp.ok) {
    if (resp.status === 429) {
      const body = await resp.text();
      const retryAfter = extractRetryAfter(body);
      setRateLimit(botToken, retryAfter);
      logger.warn(`Typing indicator 429 — rate limit set for ${retryAfter}s`);
    } else {
      logger.debug(`Typing indicator failed: ${resp.status}`);
    }
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
