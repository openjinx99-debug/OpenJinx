import { formatDurationHuman, formatZonedTimestamp } from "../infra/format-time.js";

export interface MessageEnvelopeParams {
  channel: string;
  from?: string;
  body: string;
  timestamp?: number;
  previousTimestamp?: number;
  timezone?: string;
}

/**
 * Sanitize a header part: collapse whitespace, neutralize brackets.
 */
function sanitizeHeaderPart(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, " ")
    .replaceAll("[", "(")
    .replaceAll("]", ")")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Format a message envelope wrapping the user's message body.
 *
 * Format: `[Channel From +elapsed Weekday YYYY-MM-DD HH:MM TZ] body`
 *
 * Examples:
 * - `[Telegram Tommy +5m Sat 2026-02-14 12:40 GMT] what time is it?`
 * - `[Telegram Tommy Sat 2026-02-14 12:35 GMT] hey jinx` (first message, no elapsed)
 * - `[Terminal Sat 2026-02-14 12:40 GMT] hello` (no sender name)
 */
export function formatMessageEnvelope(params: MessageEnvelopeParams): string {
  const channel = sanitizeHeaderPart(params.channel?.trim() || "Channel");
  const parts: string[] = [channel];

  // Compute elapsed time between this message and the previous one
  let elapsed: string | undefined;
  if (
    params.timestamp &&
    params.previousTimestamp &&
    Number.isFinite(params.timestamp) &&
    Number.isFinite(params.previousTimestamp)
  ) {
    const elapsedMs = params.timestamp - params.previousTimestamp;
    if (elapsedMs >= 0) {
      const dur = formatDurationHuman(elapsedMs);
      elapsed = dur === "just now" ? undefined : dur;
    }
  }

  // Add sender name (and elapsed if available)
  if (params.from?.trim()) {
    const from = sanitizeHeaderPart(params.from.trim());
    parts.push(elapsed ? `${from} +${elapsed}` : from);
  } else if (elapsed) {
    parts.push(`+${elapsed}`);
  }

  // Add timestamp with weekday and timezone
  if (params.timestamp && Number.isFinite(params.timestamp)) {
    const date = new Date(params.timestamp);
    if (!Number.isNaN(date.getTime())) {
      // Weekday prefix (short form)
      try {
        const weekday = new Intl.DateTimeFormat("en-US", {
          timeZone: params.timezone,
          weekday: "short",
        }).format(date);
        const zoned = formatZonedTimestamp(date, params.timezone);
        if (zoned) {
          parts.push(weekday ? `${weekday} ${zoned}` : zoned);
        }
      } catch {
        // Invalid timezone — try without
        const zoned = formatZonedTimestamp(date);
        if (zoned) {
          parts.push(zoned);
        }
      }
    }
  }

  const header = `[${parts.join(" ")}]`;
  return `${header} ${params.body}`;
}
