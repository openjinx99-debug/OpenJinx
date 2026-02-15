/** Format milliseconds as a compact duration string. */
export function formatDurationCompact(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return s > 0 ? `${m}m${s}s` : `${m}m`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

/** Format milliseconds as a human-friendly single-unit string. */
export function formatDurationHuman(ms: number, fallback = "just now"): string {
  if (ms < 1000) {
    return fallback;
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)}m`;
  }
  if (ms < 86_400_000) {
    return `${Math.round(ms / 3_600_000)}h`;
  }
  return `${Math.round(ms / 86_400_000)}d`;
}

/** Format a relative "time ago" string. */
export function formatTimeAgo(ms: number, suffix = true): string {
  const dur = formatDurationHuman(ms);
  if (dur === "just now") {
    return dur;
  }
  return suffix ? `${dur} ago` : dur;
}

/** Format a Date as an ISO-like timestamp (no seconds). */
export function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

/** Format a Date as UTC ISO-like timestamp. */
export function formatUtcTimestamp(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}Z`;
}

/**
 * Format a Date with timezone abbreviation using Intl.DateTimeFormat.
 * Returns `"YYYY-MM-DD HH:MM TZ"` (e.g., `"2026-02-14 12:40 GMT"`).
 * Falls back to system timezone when `timeZone` is omitted.
 * Returns undefined if Intl formatting fails.
 */
export function formatZonedTimestamp(date: Date, timeZone?: string): string | undefined {
  try {
    const intlOptions: Intl.DateTimeFormatOptions = {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    };
    const parts = new Intl.DateTimeFormat("en-US", intlOptions).formatToParts(date);
    const pick = (type: string) => parts.find((p) => p.type === type)?.value;
    const yyyy = pick("year");
    const mm = pick("month");
    const dd = pick("day");
    const hh = pick("hour");
    const min = pick("minute");
    const tz = [...parts]
      .toReversed()
      .find((p) => p.type === "timeZoneName")
      ?.value?.trim();
    if (!yyyy || !mm || !dd || !hh || !min) {
      return undefined;
    }
    return `${yyyy}-${mm}-${dd} ${hh}:${min}${tz ? ` ${tz}` : ""}`;
  } catch {
    return undefined;
  }
}
