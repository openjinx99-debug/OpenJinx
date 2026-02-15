import { describe, expect, it } from "vitest";
import { formatMessageEnvelope } from "./envelope.js";

describe("formatMessageEnvelope", () => {
  // Use a fixed timestamp for deterministic tests: 2026-02-14 12:40 UTC (Saturday)
  const ts = new Date("2026-02-14T12:40:00Z").getTime();
  const prevTs = new Date("2026-02-14T12:35:00Z").getTime();

  it("formats a basic envelope with channel, sender, and timestamp", () => {
    const result = formatMessageEnvelope({
      channel: "Telegram",
      from: "Tommy",
      body: "hey jinx",
      timestamp: ts,
      timezone: "UTC",
    });

    expect(result).toContain("[Telegram Tommy");
    expect(result).toContain("Sat");
    expect(result).toContain("2026-02-14 12:40");
    expect(result).toContain("UTC");
    expect(result).toContain("] hey jinx");
  });

  it("includes elapsed time when previousTimestamp is provided", () => {
    const result = formatMessageEnvelope({
      channel: "Telegram",
      from: "Tommy",
      body: "what time is it?",
      timestamp: ts,
      previousTimestamp: prevTs,
      timezone: "UTC",
    });

    expect(result).toContain("+5m");
    expect(result).toContain("Tommy +5m");
  });

  it("omits elapsed time for the first message (no previousTimestamp)", () => {
    const result = formatMessageEnvelope({
      channel: "Telegram",
      from: "Tommy",
      body: "hey jinx",
      timestamp: ts,
      timezone: "UTC",
    });

    expect(result).not.toContain("+");
  });

  it("omits sender name when from is not provided", () => {
    const result = formatMessageEnvelope({
      channel: "Terminal",
      body: "hello",
      timestamp: ts,
      timezone: "UTC",
    });

    expect(result).toMatch(/^\[Terminal Sat/);
    expect(result).toContain("] hello");
  });

  it("shows elapsed without sender when from is missing but previous exists", () => {
    const result = formatMessageEnvelope({
      channel: "Terminal",
      body: "hello",
      timestamp: ts,
      previousTimestamp: prevTs,
      timezone: "UTC",
    });

    expect(result).toContain("+5m");
  });

  it("sanitizes brackets in channel name", () => {
    const result = formatMessageEnvelope({
      channel: "Chan[nel]",
      from: "Tommy",
      body: "hi",
      timestamp: ts,
      timezone: "UTC",
    });

    expect(result).not.toContain("[nel]");
    expect(result).toContain("Chan(nel)");
  });

  it("sanitizes brackets in sender name", () => {
    const result = formatMessageEnvelope({
      channel: "Telegram",
      from: "[Admin]",
      body: "hi",
      timestamp: ts,
      timezone: "UTC",
    });

    expect(result).toContain("(Admin)");
  });

  it("collapses whitespace in header parts", () => {
    const result = formatMessageEnvelope({
      channel: "Telegram",
      from: "Tommy   Yau",
      body: "hi",
      timestamp: ts,
      timezone: "UTC",
    });

    expect(result).toContain("Tommy Yau");
    expect(result).not.toContain("Tommy   Yau");
  });

  it("handles missing timestamp gracefully", () => {
    const result = formatMessageEnvelope({
      channel: "Telegram",
      from: "Tommy",
      body: "hello",
    });

    // Should still have channel and from, just no timestamp
    expect(result).toContain("[Telegram Tommy]");
    expect(result).toContain("] hello");
  });

  it("falls back to 'Channel' when channel is empty", () => {
    const result = formatMessageEnvelope({
      channel: "",
      body: "hi",
      timestamp: ts,
      timezone: "UTC",
    });

    expect(result).toMatch(/^\[Channel/);
  });

  it("handles large elapsed times", () => {
    const dayAgo = ts - 86_400_000; // 1 day ago
    const result = formatMessageEnvelope({
      channel: "Telegram",
      from: "Tommy",
      body: "hey",
      timestamp: ts,
      previousTimestamp: dayAgo,
      timezone: "UTC",
    });

    expect(result).toContain("+1d");
  });

  it("omits elapsed for sub-second gaps", () => {
    const result = formatMessageEnvelope({
      channel: "Telegram",
      from: "Tommy",
      body: "hey",
      timestamp: ts,
      previousTimestamp: ts - 100, // 100ms gap
      timezone: "UTC",
    });

    // "just now" is omitted
    expect(result).not.toContain("+");
  });

  it("handles newlines in sender name", () => {
    const result = formatMessageEnvelope({
      channel: "Telegram",
      from: "Tommy\nYau",
      body: "hi",
      timestamp: ts,
      timezone: "UTC",
    });

    expect(result).toContain("Tommy Yau");
    expect(result).not.toContain("\n");
  });
});
