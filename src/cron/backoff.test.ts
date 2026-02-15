import { describe, expect, it } from "vitest";
import { computeCronBackoff, shouldDisableJob } from "./backoff.js";

describe("computeCronBackoff", () => {
  it("returns 30s for first failure", () => {
    expect(computeCronBackoff(1)).toBe(30_000);
  });

  it("increases exponentially", () => {
    const b1 = computeCronBackoff(1);
    const b2 = computeCronBackoff(2);
    const b3 = computeCronBackoff(3);
    expect(b2).toBeGreaterThan(b1);
    expect(b3).toBeGreaterThan(b2);
  });

  it("caps at 60 minutes", () => {
    expect(computeCronBackoff(100)).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("returns 0 for zero failures", () => {
    expect(computeCronBackoff(0)).toBe(0);
  });
});

describe("shouldDisableJob", () => {
  it("returns false for few failures", () => {
    expect(shouldDisableJob(1)).toBe(false);
    expect(shouldDisableJob(2)).toBe(false);
  });

  it("returns true after 3 failures", () => {
    expect(shouldDisableJob(3)).toBe(true);
    expect(shouldDisableJob(5)).toBe(true);
  });
});
