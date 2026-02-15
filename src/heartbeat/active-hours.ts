/**
 * Check if the current time is within active hours for a given timezone.
 */
export function isWithinActiveHours(
  activeHours: { start: number; end: number; timezone: string },
  now = new Date(),
): boolean {
  const { start, end, timezone } = activeHours;

  // Get the current hour in the specified timezone
  const currentHour = getCurrentHourInTimezone(now, timezone);

  if (start <= end) {
    // Normal range (e.g., 8-22)
    return currentHour >= start && currentHour < end;
  }
  // Overnight range (e.g., 22-8 means 22:00 to 08:00)
  return currentHour >= start || currentHour < end;
}

function getCurrentHourInTimezone(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hourPart = parts.find((p) => p.type === "hour");
    return hourPart ? parseInt(hourPart.value, 10) : date.getHours();
  } catch {
    // Fallback to local time if timezone is invalid
    return date.getHours();
  }
}
