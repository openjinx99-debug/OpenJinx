import { describe, expect, it } from "vitest";
import { isHeartbeatContentEffectivelyEmpty } from "./empty-check.js";

describe("isHeartbeatContentEffectivelyEmpty", () => {
  it("returns true for empty string", () => {
    expect(isHeartbeatContentEffectivelyEmpty("")).toBe(true);
  });

  it("returns true for HEARTBEAT_OK only", () => {
    expect(isHeartbeatContentEffectivelyEmpty("HEARTBEAT_OK")).toBe(true);
  });

  it("returns true for filler phrases", () => {
    expect(isHeartbeatContentEffectivelyEmpty("All clear.")).toBe(true);
    expect(isHeartbeatContentEffectivelyEmpty("Nothing to report")).toBe(true);
    expect(isHeartbeatContentEffectivelyEmpty("No items.")).toBe(true);
    expect(isHeartbeatContentEffectivelyEmpty("Everything is ok.")).toBe(true);
    expect(isHeartbeatContentEffectivelyEmpty("No action needed.")).toBe(true);
  });

  it("returns false for real content", () => {
    expect(isHeartbeatContentEffectivelyEmpty("Weather alert: storm approaching")).toBe(false);
    expect(isHeartbeatContentEffectivelyEmpty("Reminder: meeting at 3pm")).toBe(false);
  });

  it("returns true for very short text", () => {
    expect(isHeartbeatContentEffectivelyEmpty("ok")).toBe(true);
    expect(isHeartbeatContentEffectivelyEmpty("fine")).toBe(true);
  });

  it("handles whitespace-only content", () => {
    expect(isHeartbeatContentEffectivelyEmpty("   \n\n   ")).toBe(true);
  });

  it("detects 'everything is fine' filler", () => {
    expect(isHeartbeatContentEffectivelyEmpty("Everything is fine.")).toBe(true);
    expect(isHeartbeatContentEffectivelyEmpty("Everything is good")).toBe(true);
  });

  it("detects 'no action required' filler", () => {
    expect(isHeartbeatContentEffectivelyEmpty("No action required.")).toBe(true);
  });

  it("strips markdown formatting before checking", () => {
    expect(isHeartbeatContentEffectivelyEmpty("**All clear.**")).toBe(true);
    expect(isHeartbeatContentEffectivelyEmpty("# Ok")).toBe(true);
  });

  it("returns false for substantive content with markdown", () => {
    expect(isHeartbeatContentEffectivelyEmpty("**Alert**: Server CPU at 95% for 10 minutes")).toBe(
      false,
    );
  });
});
