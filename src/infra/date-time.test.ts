import { describe, expect, it, beforeEach } from "vitest";
import {
  resolveUserTimezone,
  formatUserTime,
  resolveTimeFormat,
  _resetTimeFormatCache,
} from "./date-time.js";

describe("resolveUserTimezone", () => {
  it("returns a valid configured timezone as-is", () => {
    expect(resolveUserTimezone("Europe/London")).toBe("Europe/London");
    expect(resolveUserTimezone("America/New_York")).toBe("America/New_York");
    expect(resolveUserTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("trims whitespace from configured timezone", () => {
    expect(resolveUserTimezone("  Europe/London  ")).toBe("Europe/London");
  });

  it("falls back to system timezone for invalid configured value", () => {
    const result = resolveUserTimezone("Not/A/Real/Zone");
    // Should return the system timezone, not the invalid one
    expect(result).not.toBe("Not/A/Real/Zone");
    expect(result.length).toBeGreaterThan(0);
  });

  it("falls back to system timezone when configured is undefined", () => {
    const result = resolveUserTimezone(undefined);
    expect(result.length).toBeGreaterThan(0);
    // Should be a valid IANA timezone
    expect(() => {
      new Intl.DateTimeFormat("en-US", { timeZone: result }).format(new Date());
    }).not.toThrow();
  });

  it("falls back to system timezone when configured is empty string", () => {
    const result = resolveUserTimezone("");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("formatUserTime", () => {
  // Use a fixed date: Friday, February 14th, 2026, 12:16 UTC
  const date = new Date("2026-02-14T12:16:00.000Z");

  it("formats date in 24h format", () => {
    const result = formatUserTime(date, "UTC", "24");
    expect(result).toBe("Saturday, February 14th, 2026 — 12:16");
  });

  it("formats date in 12h format", () => {
    const result = formatUserTime(date, "UTC", "12");
    expect(result).toBe("Saturday, February 14th, 2026 — 12:16 PM");
  });

  it("respects timezone offset", () => {
    // 12:16 UTC = 07:16 EST
    const result = formatUserTime(date, "America/New_York", "24");
    expect(result).toContain("07:16");
  });

  it("handles timezone that changes the day", () => {
    // Use a time near midnight UTC
    const lateDate = new Date("2026-02-14T23:30:00.000Z");
    // In Tokyo (UTC+9), this is Feb 15th 08:30
    const result = formatUserTime(lateDate, "Asia/Tokyo", "24");
    expect(result).toContain("15th");
    expect(result).toContain("08:30");
  });

  it("includes ordinal suffixes correctly", () => {
    const dates = [
      { day: "2026-01-01T12:00:00Z", suffix: "1st" },
      { day: "2026-01-02T12:00:00Z", suffix: "2nd" },
      { day: "2026-01-03T12:00:00Z", suffix: "3rd" },
      { day: "2026-01-04T12:00:00Z", suffix: "4th" },
      { day: "2026-01-11T12:00:00Z", suffix: "11th" },
      { day: "2026-01-12T12:00:00Z", suffix: "12th" },
      { day: "2026-01-13T12:00:00Z", suffix: "13th" },
      { day: "2026-01-21T12:00:00Z", suffix: "21st" },
    ];
    for (const { day, suffix } of dates) {
      const result = formatUserTime(new Date(day), "UTC", "24");
      expect(result).toContain(suffix);
    }
  });

  it("returns undefined for an invalid timezone", () => {
    const result = formatUserTime(date, "Invalid/Zone", "24");
    expect(result).toBeUndefined();
  });

  it("includes weekday name", () => {
    const result = formatUserTime(date, "UTC", "24");
    expect(result).toContain("Saturday");
  });
});

describe("resolveTimeFormat", () => {
  beforeEach(() => {
    _resetTimeFormatCache();
  });

  it("returns 12 or 24", () => {
    const result = resolveTimeFormat();
    expect(["12", "24"]).toContain(result);
  });

  it("caches the result", () => {
    const first = resolveTimeFormat();
    const second = resolveTimeFormat();
    expect(first).toBe(second);
  });
});
