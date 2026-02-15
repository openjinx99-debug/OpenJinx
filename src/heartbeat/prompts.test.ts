import { describe, it, expect, vi, afterEach } from "vitest";
import {
  selectHeartbeatPrompt,
  DEFAULT_HEARTBEAT_PROMPT,
  CRON_EVENT_BASE_PROMPT,
  EXEC_EVENT_BASE_PROMPT,
} from "./prompts.js";

describe("selectHeartbeatPrompt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes Current time header for scheduled reason", () => {
    const prompt = selectHeartbeatPrompt("scheduled");
    expect(prompt).toMatch(/^Current time: /);
  });

  it("includes Current time header for manual reason", () => {
    const prompt = selectHeartbeatPrompt("manual");
    expect(prompt).toMatch(/^Current time: /);
  });

  it("includes Current time header for cron-event reason", () => {
    const prompt = selectHeartbeatPrompt("cron-event");
    expect(prompt).toMatch(/^Current time: /);
  });

  it("includes Current time header for exec-event reason", () => {
    const prompt = selectHeartbeatPrompt("exec-event");
    expect(prompt).toMatch(/^Current time: /);
  });

  it("returns default prompt for scheduled reason", () => {
    const prompt = selectHeartbeatPrompt("scheduled");
    expect(prompt).toContain(DEFAULT_HEARTBEAT_PROMPT);
  });

  it("returns default prompt for manual reason", () => {
    const prompt = selectHeartbeatPrompt("manual");
    expect(prompt).toContain(DEFAULT_HEARTBEAT_PROMPT);
  });

  it("returns cron prompt (no HEARTBEAT_OK) for cron-event reason", () => {
    const prompt = selectHeartbeatPrompt("cron-event");
    expect(prompt).toContain(CRON_EVENT_BASE_PROMPT);
    expect(prompt).toContain("Do NOT respond with HEARTBEAT_OK");
    expect(prompt).not.toContain(DEFAULT_HEARTBEAT_PROMPT);
  });

  it("returns exec prompt (no HEARTBEAT_OK) for exec-event reason", () => {
    const prompt = selectHeartbeatPrompt("exec-event");
    expect(prompt).toContain(EXEC_EVENT_BASE_PROMPT);
    expect(prompt).toContain("Do NOT respond with HEARTBEAT_OK");
    expect(prompt).not.toContain(DEFAULT_HEARTBEAT_PROMPT);
  });

  it("uses timezone when provided", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T12:00:00Z"));

    const prompt = selectHeartbeatPrompt("scheduled", "America/New_York");
    // Should contain a formatted time string (not just ISO)
    expect(prompt).toMatch(/^Current time: /);
    // The EST/EDT abbreviation should appear
    expect(prompt).toMatch(/EST|EDT/);
  });

  it("appends IANA timezone identifier when timezone is provided", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T12:00:00Z"));

    const prompt = selectHeartbeatPrompt("scheduled", "America/New_York");
    expect(prompt).toContain("(America/New_York)");
  });

  it("does not append IANA suffix when no timezone is provided", () => {
    const prompt = selectHeartbeatPrompt("scheduled");
    expect(prompt).not.toMatch(/\([A-Z]/);
  });

  it("falls back to ISO when timezone formatting fails", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T12:00:00Z"));

    // Invalid timezone should still produce a prompt with ISO fallback
    const prompt = selectHeartbeatPrompt("scheduled", "Invalid/Timezone");
    expect(prompt).toMatch(/^Current time: /);
  });

  it("falls back to default when cron-event but hasEvents is false", () => {
    const prompt = selectHeartbeatPrompt("cron-event", undefined, false);
    expect(prompt).toContain(DEFAULT_HEARTBEAT_PROMPT);
    expect(prompt).not.toContain(CRON_EVENT_BASE_PROMPT);
  });

  it("falls back to default when exec-event but hasEvents is false", () => {
    const prompt = selectHeartbeatPrompt("exec-event", undefined, false);
    expect(prompt).toContain(DEFAULT_HEARTBEAT_PROMPT);
    expect(prompt).not.toContain(EXEC_EVENT_BASE_PROMPT);
  });

  it("uses event prompt when hasEvents is undefined (backward compat)", () => {
    const prompt = selectHeartbeatPrompt("cron-event");
    expect(prompt).toContain(CRON_EVENT_BASE_PROMPT);
    expect(prompt).not.toContain(DEFAULT_HEARTBEAT_PROMPT);
  });

  it("uses event prompt when hasEvents is true", () => {
    const prompt = selectHeartbeatPrompt("exec-event", undefined, true);
    expect(prompt).toContain(EXEC_EVENT_BASE_PROMPT);
    expect(prompt).not.toContain(DEFAULT_HEARTBEAT_PROMPT);
  });
});
