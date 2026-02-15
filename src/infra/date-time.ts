import { execSync } from "node:child_process";

export type ResolvedTimeFormat = "12" | "24";

let cachedTimeFormat: ResolvedTimeFormat | undefined;

/**
 * Resolve the user's timezone. Validates a configured value, falling back
 * to system Intl detection, then UTC.
 */
export function resolveUserTimezone(configured?: string): string {
  const trimmed = configured?.trim();
  if (trimmed) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
      return trimmed;
    } catch {
      // invalid timezone, fall through
    }
  }
  const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return host?.trim() || "UTC";
}

/**
 * Detect whether the system prefers 24-hour time format.
 * Checks macOS defaults, Windows PowerShell, then falls back to Intl.
 */
function detectSystemTimeFormat(): boolean {
  if (process.platform === "darwin") {
    try {
      const result = execSync("defaults read -g AppleICUForce24HourTime 2>/dev/null", {
        encoding: "utf8",
        timeout: 500,
      }).trim();
      if (result === "1") {
        return true;
      }
      if (result === "0") {
        return false;
      }
    } catch {
      // Not set, fall through
    }
  }

  try {
    const sample = new Date(2000, 0, 1, 13, 0);
    const formatted = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(sample);
    return formatted.includes("13");
  } catch {
    return false;
  }
}

/** Resolve the time format preference (auto-detect from system). */
export function resolveTimeFormat(): ResolvedTimeFormat {
  if (cachedTimeFormat) {
    return cachedTimeFormat;
  }
  cachedTimeFormat = detectSystemTimeFormat() ? "24" : "12";
  return cachedTimeFormat;
}

/** Reset the cached time format (for testing). */
export function _resetTimeFormatCache(): void {
  cachedTimeFormat = undefined;
}

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) {
    return "th";
  }
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * Format a Date into a human-readable string like:
 * "Friday, February 14th, 2026 — 12:16" (24h)
 * "Friday, February 14th, 2026 — 12:16 PM" (12h)
 */
export function formatUserTime(
  date: Date,
  timeZone: string,
  format?: ResolvedTimeFormat,
): string | undefined {
  const use24Hour = (format ?? resolveTimeFormat()) === "24";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: use24Hour ? "2-digit" : "numeric",
      minute: "2-digit",
      hourCycle: use24Hour ? "h23" : "h12",
    }).formatToParts(date);

    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        map[part.type] = part.value;
      }
    }

    if (!map.weekday || !map.year || !map.month || !map.day || !map.hour || !map.minute) {
      return undefined;
    }

    const dayNum = parseInt(map.day, 10);
    const suffix = ordinalSuffix(dayNum);
    const timePart = use24Hour
      ? `${map.hour}:${map.minute}`
      : `${map.hour}:${map.minute} ${map.dayPeriod ?? ""}`.trim();

    return `${map.weekday}, ${map.month} ${dayNum}${suffix}, ${map.year} — ${timePart}`;
  } catch {
    return undefined;
  }
}
