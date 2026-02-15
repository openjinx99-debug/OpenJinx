import { describe, expect, it } from "vitest";
import { isWithinActiveHours } from "./active-hours.js";

describe("isWithinActiveHours", () => {
  it("returns true within normal range", () => {
    const date = new Date("2025-01-15T14:00:00Z");
    expect(isWithinActiveHours({ start: 8, end: 22, timezone: "UTC" }, date)).toBe(true);
  });

  it("returns false outside normal range", () => {
    const date = new Date("2025-01-15T03:00:00Z");
    expect(isWithinActiveHours({ start: 8, end: 22, timezone: "UTC" }, date)).toBe(false);
  });

  it("handles overnight range", () => {
    const lateNight = new Date("2025-01-15T23:00:00Z");
    const earlyMorning = new Date("2025-01-15T05:00:00Z");
    const midDay = new Date("2025-01-15T14:00:00Z");

    // 22-8 means active from 22:00 to 08:00
    const hours = { start: 22, end: 8, timezone: "UTC" };

    expect(isWithinActiveHours(hours, lateNight)).toBe(true);
    expect(isWithinActiveHours(hours, earlyMorning)).toBe(true);
    expect(isWithinActiveHours(hours, midDay)).toBe(false);
  });

  it("handles boundary hour (at start)", () => {
    const date = new Date("2025-01-15T08:00:00Z");
    expect(isWithinActiveHours({ start: 8, end: 22, timezone: "UTC" }, date)).toBe(true);
  });

  it("handles boundary hour (at end, exclusive)", () => {
    const date = new Date("2025-01-15T22:00:00Z");
    expect(isWithinActiveHours({ start: 8, end: 22, timezone: "UTC" }, date)).toBe(false);
  });

  it("falls back to local time for invalid timezone", () => {
    const date = new Date("2025-01-15T14:00:00Z");
    // Should not throw, falls back to local time
    const result = isWithinActiveHours({ start: 0, end: 24, timezone: "Invalid/Timezone" }, date);
    expect(typeof result).toBe("boolean");
    // With 0-24 range, should always be true regardless of timezone fallback
    expect(result).toBe(true);
  });

  it("handles timezone-aware hours (America/New_York)", () => {
    // 19:00 UTC = 14:00 EST
    const date = new Date("2025-01-15T19:00:00Z");
    expect(isWithinActiveHours({ start: 8, end: 22, timezone: "America/New_York" }, date)).toBe(
      true,
    );
  });
});
