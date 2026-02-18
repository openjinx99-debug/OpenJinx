import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../infra/logger.js", () => ({
  createLogger: () => loggerMocks,
}));

function mockTelegramResponse(result: unknown, ok = true): Response {
  return new Response(JSON.stringify({ ok, result }), {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
}

const { TelegramMonitor } = await import("./monitor.js");

describe("TelegramMonitor logging", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces repeated identical poll errors and logs recovery summary", async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(mockTelegramResponse([]));

    const monitor = new TelegramMonitor("tok", vi.fn());
    monitor.start();

    await vi.advanceTimersByTimeAsync(600); // first error
    await vi.advanceTimersByTimeAsync(1100); // second error (same signature, should be suppressed)
    await vi.advanceTimersByTimeAsync(2100); // next poll succeeds

    const pollWarnings = loggerMocks.warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("Poll error, backing off"));
    expect(pollWarnings).toHaveLength(1);

    const recoveryMessages = loggerMocks.info.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("Telegram polling recovered"));
    expect(recoveryMessages).toHaveLength(1);
    expect(recoveryMessages[0]).toContain("suppressed 1 repeated errors");

    monitor.stop();
  });

  it("logs immediately when poll error signature changes", async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error("dns error"))
      .mockRejectedValueOnce(new Error("timeout error"));

    const monitor = new TelegramMonitor("tok", vi.fn());
    monitor.start();

    await vi.advanceTimersByTimeAsync(600); // first error
    await vi.advanceTimersByTimeAsync(1100); // second error with different signature

    const pollWarnings = loggerMocks.warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("Poll error, backing off"));
    expect(pollWarnings).toHaveLength(2);

    monitor.stop();
  });
});
