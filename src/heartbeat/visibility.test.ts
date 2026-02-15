import { describe, expect, it } from "vitest";
import type { HeartbeatVisibilityConfig } from "../types/config.js";
import type { HeartbeatVisibility } from "../types/heartbeat.js";
import { resolveVisibility, shouldDeliver } from "./visibility.js";

describe("resolveVisibility", () => {
  const globalConfig: HeartbeatVisibilityConfig = {
    showOk: false,
    showAlerts: true,
    useIndicator: true,
  };

  it("returns global config when no channel override is provided", () => {
    const result = resolveVisibility(globalConfig);
    expect(result).toEqual({
      showOk: false,
      showAlerts: true,
      useIndicator: true,
    });
  });

  it("applies channel overrides over global config", () => {
    const result = resolveVisibility(globalConfig, { showOk: true });
    expect(result).toEqual({
      showOk: true,
      showAlerts: true,
      useIndicator: true,
    });
  });

  it("applies multiple channel overrides at once", () => {
    const result = resolveVisibility(globalConfig, {
      showOk: true,
      showAlerts: false,
      useIndicator: false,
    });
    expect(result).toEqual({
      showOk: true,
      showAlerts: false,
      useIndicator: false,
    });
  });

  it("uses global values for fields not present in channel override", () => {
    const result = resolveVisibility(globalConfig, {});
    expect(result).toEqual({
      showOk: false,
      showAlerts: true,
      useIndicator: true,
    });
  });

  it("handles false overrides correctly (not treated as missing)", () => {
    const allTrueGlobal: HeartbeatVisibilityConfig = {
      showOk: true,
      showAlerts: true,
      useIndicator: true,
    };
    const result = resolveVisibility(allTrueGlobal, {
      showOk: false,
      showAlerts: false,
    });
    expect(result.showOk).toBe(false);
    expect(result.showAlerts).toBe(false);
    expect(result.useIndicator).toBe(true);
  });
});

describe("shouldDeliver", () => {
  it("returns showOk when wasOk and no content", () => {
    const visibility: HeartbeatVisibility = {
      showOk: true,
      showAlerts: true,
      useIndicator: false,
    };
    expect(shouldDeliver(visibility, false, true)).toBe(true);
  });

  it("suppresses ok heartbeats when showOk is false", () => {
    const visibility: HeartbeatVisibility = {
      showOk: false,
      showAlerts: true,
      useIndicator: false,
    };
    expect(shouldDeliver(visibility, false, true)).toBe(false);
  });

  it("returns showAlerts when there is content", () => {
    const visibility: HeartbeatVisibility = {
      showOk: false,
      showAlerts: true,
      useIndicator: false,
    };
    expect(shouldDeliver(visibility, true, false)).toBe(true);
  });

  it("suppresses alert content when showAlerts is false", () => {
    const visibility: HeartbeatVisibility = {
      showOk: true,
      showAlerts: false,
      useIndicator: false,
    };
    expect(shouldDeliver(visibility, true, false)).toBe(false);
  });

  it("returns false when not ok and no content", () => {
    const visibility: HeartbeatVisibility = {
      showOk: true,
      showAlerts: true,
      useIndicator: false,
    };
    expect(shouldDeliver(visibility, false, false)).toBe(false);
  });

  it("returns showAlerts when hasContent is true even if wasOk is true", () => {
    const visibility: HeartbeatVisibility = {
      showOk: false,
      showAlerts: true,
      useIndicator: false,
    };
    // hasContent takes precedence: checked before wasOk+!hasContent
    expect(shouldDeliver(visibility, true, true)).toBe(true);
  });
});
