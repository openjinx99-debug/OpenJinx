/**
 * System test: Cron Flow.
 * Crosses: Cron + System Events + Heartbeat + Agent + Channels.
 *
 * Verifies cron job execution, event routing, and heartbeat processing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestHarness, type TestHarness } from "../__test__/harness.js";
import { computeCronBackoff, shouldDisableJob } from "../cron/backoff.js";
import { executeJobCore } from "../cron/executor.js";
import { createJob } from "../cron/jobs.js";
import { formatSystemEvents } from "../events/formatting.js";
import { createEventQueue } from "../events/queue.js";
import { clearDuplicateStore } from "../heartbeat/duplicate.js";
import { buildCronEventPrompt } from "../heartbeat/prompts.js";
import { HeartbeatRunner } from "../heartbeat/runner.js";
import { resolveVisibility, shouldDeliver } from "../heartbeat/visibility.js";

let harness: TestHarness;

beforeEach(async () => {
  harness = await createTestHarness();
  clearDuplicateStore();
});

afterEach(async () => {
  await harness.cleanup();
});

describe("Cron flow system tests", () => {
  it("cron fires → event enqueued → heartbeat wakes → agent processes → delivery", async () => {
    // 1. Create cron job
    const job = createJob({
      name: "weather-check",
      schedule: { type: "every", intervalMs: 300_000 },
      payload: { prompt: "Check the weather forecast", isolated: false },
      target: { agentId: "default" },
    });

    // 2. Execute the cron job (simulated agent turn)
    let cronResponse = "";
    await executeJobCore(job, async (_prompt) => {
      cronResponse = "Weather: Clear skies, 72F, light breeze";
      return cronResponse;
    });

    expect(job.failCount).toBe(0);
    expect(job.lastRunAt).toBeDefined();

    // 3. Enqueue event for heartbeat
    const queue = createEventQueue();
    queue.enqueue(`Cron "${job.name}" completed: ${cronResponse}`, "hb:default", "cron");

    // 4. Heartbeat drains events
    const events = queue.drain("hb:default");
    expect(events).toHaveLength(1);

    // 5. Format events for prompt
    const formatted = formatSystemEvents(events);
    expect(formatted).toContain("weather-check");
    expect(formatted).toContain("Clear skies");

    // 6. Heartbeat processes and delivers
    const runner = new HeartbeatRunner(harness.config, async (_agentId, _prompt) => {
      return "Weather update: Clear skies, 72F. No weather alerts needed.";
    });

    runner.registerAgent("default", 60_000);
    const event = await runner.runOnce("default");
    expect(event.hasContent).toBe(true);

    // 7. Deliver to channel
    const visibility = resolveVisibility(harness.config.heartbeat.visibility);
    if (shouldDeliver(visibility, event.hasContent, event.wasOk) && event.text) {
      await harness.channel.send("admin", { text: event.text });
    }

    expect(harness.channel.deliveries).toHaveLength(1);
    expect(harness.channel.deliveries[0].payload.text).toContain("Clear skies");
  });

  it("one-shot cron job fires and auto-disables", async () => {
    const now = Date.now();
    const job = createJob({
      name: "one-time-reminder",
      schedule: { type: "at", timestamp: now },
      payload: { prompt: "Remind about the meeting", isolated: false },
      target: { agentId: "default" },
    });

    expect(job.enabled).toBe(true);
    expect(job.schedule.type).toBe("at");

    // Execute
    await executeJobCore(job, async () => "Reminder sent!");

    // One-shot job should auto-disable
    expect(job.enabled).toBe(false);
    expect(job.failCount).toBe(0);
  });

  it("cron backoff on consecutive failures", async () => {
    const job = createJob({
      name: "failing-job",
      schedule: { type: "every", intervalMs: 60_000 },
      payload: { prompt: "Do something", isolated: false },
      target: { agentId: "default" },
    });

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      await executeJobCore(job, async () => {
        throw new Error("fail");
      });
    }

    // Should have exponential backoff
    expect(job.failCount).toBe(3);
    expect(job.backoffMs).toBeGreaterThan(0);

    // Verify backoff values
    expect(computeCronBackoff(1)).toBe(30_000); // 30s
    expect(computeCronBackoff(2)).toBe(60_000); // 60s
    expect(computeCronBackoff(3)).toBe(120_000); // 120s

    // Job should be auto-disabled after 3 failures
    expect(shouldDisableJob(3)).toBe(true);
    expect(job.enabled).toBe(false);
  });

  it("successful execution resets failure state", async () => {
    const job = createJob({
      name: "recovering-job",
      schedule: { type: "every", intervalMs: 60_000 },
      payload: { prompt: "Do something", isolated: false },
      target: { agentId: "default" },
    });

    // Fail twice
    for (let i = 0; i < 2; i++) {
      await executeJobCore(job, async () => {
        throw new Error("fail");
      });
    }
    expect(job.failCount).toBe(2);
    expect(job.backoffMs).toBeGreaterThan(0);
    expect(job.enabled).toBe(true); // Not yet at threshold

    // Succeed
    await executeJobCore(job, async () => "success");
    expect(job.failCount).toBe(0);
    expect(job.backoffMs).toBe(0);
    expect(job.enabled).toBe(true);
  });

  it("cron event prompt includes job name and payload", () => {
    const prompt = buildCronEventPrompt("daily-summary", "Tasks completed: 5\nPending: 3\n");

    expect(prompt).toContain("daily-summary");
    expect(prompt).toContain("Tasks completed: 5");
    expect(prompt).toContain("Pending: 3");
  });
});
