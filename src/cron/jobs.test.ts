import { describe, expect, it } from "vitest";
import { createJob, computeNextRun, computeNextCronRun } from "./jobs.js";

describe("createJob", () => {
  it("creates a job with defaults", () => {
    const job = createJob({
      name: "Test",
      schedule: { type: "every", intervalMs: 60_000 },
      payload: { prompt: "hello", isolated: false },
      target: { agentId: "default" },
    });
    expect(job.name).toBe("Test");
    expect(job.enabled).toBe(true);
    expect(job.failCount).toBe(0);
    expect(job.id).toBeTruthy();
  });

  it("respects enabled override", () => {
    const job = createJob({
      name: "Test",
      schedule: { type: "every", intervalMs: 60_000 },
      payload: { prompt: "hello", isolated: false },
      target: { agentId: "default" },
      enabled: false,
    });
    expect(job.enabled).toBe(false);
  });
});

describe("computeNextRun", () => {
  it("returns timestamp for at-type", () => {
    const ts = Date.now() + 5000;
    expect(computeNextRun({ type: "at", timestamp: ts })).toBe(ts);
  });

  it("returns now + interval for every-type", () => {
    const now = Date.now();
    const result = computeNextRun({ type: "every", intervalMs: 60_000 }, now);
    expect(result).toBe(now + 60_000);
  });

  it("uses cron parser for cron-type", () => {
    const now = new Date("2024-06-15T12:03:00.000Z").getTime();
    const result = computeNextRun({ type: "cron", expression: "*/5 * * * *" }, now);
    // Should find next */5 match within a few minutes
    expect(result).toBeGreaterThan(now);
    expect(result).toBeLessThanOrEqual(now + 5 * 60_000);
  });
});

describe("computeNextCronRun", () => {
  it("handles */5 * * * * (every 5 minutes)", () => {
    const now = new Date("2024-06-15T12:03:00.000Z").getTime();
    const next = computeNextCronRun("*/5 * * * *", now);
    // Next match after :03 is :05. Scanner uses local time via Date methods,
    // so validate the relative offset instead of absolute minutes.
    expect(next).toBeGreaterThan(now);
    expect(next).toBeLessThanOrEqual(now + 5 * 60_000);
  });

  it("handles 0 9 * * * (daily at 9:00)", () => {
    const now = new Date("2024-06-15T08:30:00.000Z").getTime();
    const next = computeNextCronRun("0 9 * * *", now);
    // Should be within 24 hours
    expect(next).toBeGreaterThan(now);
    expect(next).toBeLessThanOrEqual(now + 24 * 60 * 60_000);
    // The resolved date should have minute=0
    const d = new Date(next);
    expect(d.getMinutes()).toBe(0);
  });

  it("handles 0 */2 * * * (every 2 hours on the hour)", () => {
    const now = new Date("2024-06-15T13:30:00.000Z").getTime();
    const next = computeNextCronRun("0 */2 * * *", now);
    const d = new Date(next);
    expect(d.getMinutes()).toBe(0);
    expect(d.getHours() % 2).toBe(0);
    expect(next).toBeGreaterThan(now);
  });

  it("handles 30 * * * * (every hour at :30)", () => {
    const now = new Date("2024-06-15T12:15:00.000Z").getTime();
    const next = computeNextCronRun("30 * * * *", now);
    const d = new Date(next);
    expect(d.getMinutes()).toBe(30);
    expect(next).toBeGreaterThan(now);
    // Should be within 1 hour
    expect(next).toBeLessThanOrEqual(now + 60 * 60_000);
  });

  it("wraps to next day when no match today", () => {
    // 23:50 local — looking for 0 9 * * * should find a match within 48h
    const now = new Date("2024-06-15T23:50:00.000Z").getTime();
    const next = computeNextCronRun("0 9 * * *", now);
    expect(next).toBeGreaterThan(now);
    expect(next).toBeLessThanOrEqual(now + 48 * 60 * 60_000);
    const d = new Date(next);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });

  it("falls back to +60s for invalid expression", () => {
    const now = Date.now();
    const result = computeNextCronRun("invalid", now);
    expect(result).toBe(now + 60_000);
  });

  it("handles ranges: 0 9-17 * * * (hourly 9am-5pm)", () => {
    // Start at 10:30 — next should be 11:00
    const now = new Date("2024-06-15T10:30:00.000Z").getTime();
    const next = computeNextCronRun("0 9-17 * * *", now);
    const d = new Date(next);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCHours()).toBeGreaterThanOrEqual(9);
    expect(d.getUTCHours()).toBeLessThanOrEqual(17);
    expect(next).toBeGreaterThan(now);
  });

  it("handles lists: 0 9,12,18 * * * (three times daily)", () => {
    const now = new Date("2024-06-15T10:00:00.000Z").getTime();
    const next = computeNextCronRun("0 9,12,18 * * *", now, "Etc/UTC");
    const d = new Date(next);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCHours()).toBe(12); // next after 10:00 UTC is 12:00 UTC
    expect(next).toBeGreaterThan(now);
  });

  it("handles day-of-week: 0 9 * * 1-5 (weekdays only)", () => {
    // 2024-06-15 is a Saturday — next weekday is Monday 2024-06-17
    const now = new Date("2024-06-15T10:00:00.000Z").getTime();
    const next = computeNextCronRun("0 9 * * 1-5", now, "Etc/UTC");
    const d = new Date(next);
    expect(d.getUTCDay()).toBeGreaterThanOrEqual(1);
    expect(d.getUTCDay()).toBeLessThanOrEqual(5);
    expect(d.getUTCHours()).toBe(9);
    expect(next).toBeGreaterThan(now);
  });

  it("handles combined step+range: */15 9-17 * * *", () => {
    const now = new Date("2024-06-15T10:07:00.000Z").getTime();
    const next = computeNextCronRun("*/15 9-17 * * *", now);
    const d = new Date(next);
    expect(d.getUTCMinutes() % 15).toBe(0);
    expect(d.getUTCHours()).toBeGreaterThanOrEqual(9);
    expect(d.getUTCHours()).toBeLessThanOrEqual(17);
    expect(next).toBeGreaterThan(now);
  });

  it("supports timezone parameter", () => {
    const now = new Date("2024-06-15T06:00:00.000Z").getTime();
    // 0 9 * * * in America/New_York = 9:00 EDT = 13:00 UTC
    const next = computeNextCronRun("0 9 * * *", now, "America/New_York");
    const d = new Date(next);
    // 9:00 EDT in summer = 13:00 UTC
    expect(d.getUTCHours()).toBe(13);
    expect(d.getUTCMinutes()).toBe(0);
    expect(next).toBeGreaterThan(now);
  });
});
