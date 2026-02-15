import { describe, expect, it } from "vitest";
import {
  formatDurationCompact,
  formatDurationHuman,
  formatTimeAgo,
  formatTimestamp,
  formatUtcTimestamp,
  formatZonedTimestamp,
} from "./format-time.js";

describe("formatDurationCompact", () => {
  it("formats milliseconds", () => {
    expect(formatDurationCompact(500)).toBe("500ms");
  });

  it("formats seconds", () => {
    expect(formatDurationCompact(5000)).toBe("5.0s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDurationCompact(125_000)).toBe("2m5s");
  });

  it("formats hours and minutes", () => {
    expect(formatDurationCompact(5_400_000)).toBe("1h30m");
  });

  it("formats hours only", () => {
    expect(formatDurationCompact(3_600_000)).toBe("1h");
  });
});

describe("formatDurationHuman", () => {
  it("returns fallback for sub-second", () => {
    expect(formatDurationHuman(500)).toBe("just now");
  });

  it("returns seconds", () => {
    expect(formatDurationHuman(5000)).toBe("5s");
  });

  it("returns minutes", () => {
    expect(formatDurationHuman(120_000)).toBe("2m");
  });

  it("returns hours", () => {
    expect(formatDurationHuman(7_200_000)).toBe("2h");
  });

  it("returns days", () => {
    expect(formatDurationHuman(172_800_000)).toBe("2d");
  });
});

describe("formatTimeAgo", () => {
  it("returns 'just now' for small durations", () => {
    expect(formatTimeAgo(100)).toBe("just now");
  });

  it("adds 'ago' suffix by default", () => {
    expect(formatTimeAgo(60_000)).toBe("1m ago");
  });

  it("omits suffix when requested", () => {
    expect(formatTimeAgo(60_000, false)).toBe("1m");
  });
});

describe("formatTimestamp", () => {
  it("formats a date as local timestamp", () => {
    const date = new Date("2025-01-15T14:30:00Z");
    const result = formatTimestamp(date);
    // Local timezone varies, just check format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe("formatUtcTimestamp", () => {
  it("formats a date as UTC timestamp", () => {
    const date = new Date("2025-01-15T14:30:00Z");
    expect(formatUtcTimestamp(date)).toBe("2025-01-15T14:30Z");
  });
});

describe("formatZonedTimestamp", () => {
  it("formats a date with UTC timezone", () => {
    const date = new Date("2026-02-14T12:40:00Z");
    const result = formatZonedTimestamp(date, "UTC");
    expect(result).toBe("2026-02-14 12:40 UTC");
  });

  it("formats a date with named timezone", () => {
    const date = new Date("2026-02-14T12:40:00Z");
    const result = formatZonedTimestamp(date, "America/New_York");
    // February is EST (UTC-5)
    expect(result).toContain("2026-02-14 07:40");
    expect(result).toMatch(/EST/);
  });

  it("falls back to system timezone when no timezone is given", () => {
    const date = new Date("2026-02-14T12:40:00Z");
    const result = formatZonedTimestamp(date);
    // Should return some valid format regardless of system tz
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it("returns undefined for invalid timezone", () => {
    const date = new Date("2026-02-14T12:40:00Z");
    const result = formatZonedTimestamp(date, "Invalid/Timezone");
    expect(result).toBeUndefined();
  });

  it("includes timezone abbreviation in output", () => {
    const date = new Date("2026-02-14T12:40:00Z");
    const result = formatZonedTimestamp(date, "Europe/London");
    expect(result).toContain("GMT");
  });
});
