import type { IncomingHttpHeaders } from "node:http";
import type { TelegramChannelConfig } from "../../types/config.js";
import type { TelegramUpdate } from "./context.js";
import { createLogger } from "../../infra/logger.js";

const logger = createLogger("telegram:webhook");

/**
 * Register the Telegram webhook with the Bot API.
 * Sets the webhook URL and secret token so Telegram sends updates via POST.
 */
export async function registerTelegramWebhook(config: TelegramChannelConfig): Promise<void> {
  const { botToken, webhookUrl, secretToken } = config;
  if (!botToken || !webhookUrl) {
    throw new Error("Telegram webhook requires botToken and webhookUrl");
  }

  const url = `https://api.telegram.org/bot${botToken}/setWebhook`;
  const body: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ["message"],
  };

  if (secretToken) {
    body.secret_token = secretToken;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`setWebhook failed: ${resp.status} ${text}`);
  }

  const json = (await resp.json()) as { ok: boolean; description?: string };
  if (!json.ok) {
    throw new Error(`setWebhook not ok: ${json.description ?? "unknown error"}`);
  }

  logger.info(`Telegram webhook registered: ${webhookUrl}`);
}

/**
 * Delete the Telegram webhook (revert to polling mode).
 */
export async function deleteTelegramWebhook(botToken: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/deleteWebhook`;

  const resp = await fetch(url, { method: "POST" });
  if (!resp.ok) {
    logger.warn(`deleteWebhook failed: ${resp.status}`);
  }
}

/**
 * Verify and parse an incoming Telegram webhook request.
 * Returns the parsed update, or null if verification fails.
 */
export function parseTelegramWebhookRequest(
  body: string,
  headers: IncomingHttpHeaders,
  secretToken?: string,
): TelegramUpdate | null {
  // Verify secret token if configured
  if (secretToken) {
    const headerToken = headers["x-telegram-bot-api-secret-token"];
    if (headerToken !== secretToken) {
      logger.warn("Telegram webhook secret token mismatch");
      return null;
    }
  }

  try {
    return JSON.parse(body) as TelegramUpdate;
  } catch {
    logger.warn("Failed to parse Telegram webhook body");
    return null;
  }
}
