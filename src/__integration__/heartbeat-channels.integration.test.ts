/**
 * Integration: Heartbeat → Channel delivery boundary.
 * Tests heartbeat event visibility, delivery, and suppression.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { HeartbeatEvent } from "../types/heartbeat.js";
import { createTestConfig } from "../__test__/config.js";
import { createMockChannel, type MockChannel } from "../__test__/mock-channel.js";
import { isWithinActiveHours } from "../heartbeat/active-hours.js";
import {
  isDuplicateHeartbeat,
  recordHeartbeatText,
  clearDuplicateStore,
} from "../heartbeat/duplicate.js";
import { isHeartbeatContentEffectivelyEmpty } from "../heartbeat/empty-check.js";
import { onHeartbeatEvent } from "../heartbeat/events.js";
import { containsHeartbeatOk, stripHeartbeatOk } from "../heartbeat/heartbeat-ok.js";
import { HeartbeatRunner } from "../heartbeat/runner.js";
import { resolveVisibility, shouldDeliver } from "../heartbeat/visibility.js";

let mockChannel: MockChannel;

beforeEach(() => {
  mockChannel = createMockChannel("telegram");
  clearDuplicateStore();
});

afterEach(() => {
  mockChannel.reset();
});

describe("Heartbeat → Channel delivery", () => {
  it("delivers content to channel when showAlerts=true", async () => {
    const config = createTestConfig({ heartbeat: { visibility: { showAlerts: true } } });
    const visibility = resolveVisibility(config.heartbeat.visibility);
    const events: HeartbeatEvent[] = [];
    const unsub = onHeartbeatEvent((e) => events.push(e));

    const runner = new HeartbeatRunner(config, async () => {
      return "Weather alert: storm approaching!";
    });
    runner.registerAgent("test", 60_000);
    const event = await runner.runOnce("test");

    expect(event.hasContent).toBe(true);
    expect(event.text).toContain("storm approaching");

    // Should be deliverable
    expect(shouldDeliver(visibility, event.hasContent, event.wasOk)).toBe(true);

    // Simulate delivery
    if (shouldDeliver(visibility, event.hasContent, event.wasOk) && event.text) {
      await mockChannel.send("user-1", { text: event.text });
    }

    expect(mockChannel.deliveries).toHaveLength(1);
    expect(mockChannel.deliveries[0].payload.text).toContain("storm approaching");

    unsub();
  });

  it("suppresses HEARTBEAT_OK when showOk=false", async () => {
    const config = createTestConfig({ heartbeat: { visibility: { showOk: false } } });
    const visibility = resolveVisibility(config.heartbeat.visibility);

    const runner = new HeartbeatRunner(config, async () => "HEARTBEAT_OK");
    runner.registerAgent("test", 60_000);
    const event = await runner.runOnce("test");

    expect(event.wasOk).toBe(true);
    expect(event.hasContent).toBe(false);
    expect(shouldDeliver(visibility, event.hasContent, event.wasOk)).toBe(false);

    // No delivery should happen
    expect(mockChannel.deliveries).toHaveLength(0);
  });

  it("suppresses duplicate deliveries within 24h", async () => {
    const duplicateText = "Reminder: server maintenance tonight";

    // First heartbeat
    const runner = new HeartbeatRunner(createTestConfig(), async () => duplicateText);
    runner.registerAgent("test", 60_000);

    const event1 = await runner.runOnce("test");
    expect(event1.hasContent).toBe(true);
    expect(event1.text).toBe(duplicateText);

    // Second heartbeat with same text — runner handles dedup internally
    const event2 = await runner.runOnce("test");
    // The runner marks duplicate events as wasOk with no content
    expect(event2.hasContent).toBe(false);
  });

  it("respects active hours (skips outside hours)", () => {
    // 3 AM UTC is outside 8-22 hours
    const threeAm = new Date("2025-01-15T03:00:00Z");
    const activeHours = { start: 8, end: 22, timezone: "UTC" };

    expect(isWithinActiveHours(activeHours, threeAm)).toBe(false);

    // 14:00 UTC is within hours
    const twopm = new Date("2025-01-15T14:00:00Z");
    expect(isWithinActiveHours(activeHours, twopm)).toBe(true);
  });

  it("full pipeline: content heartbeat → strip OK → check empty → check duplicate → deliver", async () => {
    const responseText = "Alert: CPU at 95%. HEARTBEAT_OK";
    const config = createTestConfig({
      heartbeat: { visibility: { showAlerts: true, showOk: false } },
    });
    const visibility = resolveVisibility(config.heartbeat.visibility);

    // Simulate heartbeat processing pipeline
    const wasOk = containsHeartbeatOk(responseText);
    const cleaned = stripHeartbeatOk(responseText);
    const isEmpty = isHeartbeatContentEffectivelyEmpty(cleaned);
    const hasContent = !isEmpty && cleaned.length > 0;

    expect(wasOk).toBe(true);
    expect(cleaned).toBe("Alert: CPU at 95%.");
    expect(isEmpty).toBe(false);
    expect(hasContent).toBe(true);

    // Check delivery decision
    expect(shouldDeliver(visibility, hasContent, wasOk)).toBe(true);

    // Check not duplicate
    expect(isDuplicateHeartbeat("agent", cleaned)).toBe(false);

    // Record and deliver
    recordHeartbeatText("agent", cleaned);
    await mockChannel.send("admin", { text: cleaned });

    expect(mockChannel.deliveries).toHaveLength(1);
    expect(mockChannel.deliveries[0].payload.text).toBe("Alert: CPU at 95%.");
  });
});
