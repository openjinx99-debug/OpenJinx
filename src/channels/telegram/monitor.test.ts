import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramUpdate } from "./context.js";
import { TelegramMonitor } from "./monitor.js";

function mockTelegramResponse(result: unknown, ok = true): Response {
  return new Response(JSON.stringify({ ok, result }), {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
}

function makeUpdate(id: number, text = "hi"): TelegramUpdate {
  return {
    update_id: id,
    message: {
      message_id: id * 10,
      from: { id: 1, first_name: "User" },
      chat: { id: 1, type: "private" },
      text,
      date: 1700000000,
    },
  };
}

describe("TelegramMonitor", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("poll() sends correct getUpdates request", async () => {
    const onUpdate = vi.fn();
    const monitor = new TelegramMonitor("test-token", onUpdate);

    fetchSpy.mockResolvedValueOnce(mockTelegramResponse([]));

    // Access the private poll method via start + timer
    monitor.start();
    await vi.advanceTimersByTimeAsync(600); // past POLL_INTERVAL_MS (500)

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottest-token/getUpdates");
    expect(init?.method).toBe("POST");

    const body = JSON.parse(init?.body as string);
    expect(body.offset).toBe(0);
    expect(body.timeout).toBe(25);
    expect(body.allowed_updates).toEqual(["message"]);

    monitor.stop();
  });

  it("calls onUpdate for each update in response", async () => {
    const onUpdate = vi.fn();
    const monitor = new TelegramMonitor("tok", onUpdate);

    const updates = [makeUpdate(1, "first"), makeUpdate(2, "second")];
    fetchSpy.mockResolvedValueOnce(mockTelegramResponse(updates));

    monitor.start();
    await vi.advanceTimersByTimeAsync(600);

    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenCalledWith(updates[0]);
    expect(onUpdate).toHaveBeenCalledWith(updates[1]);

    monitor.stop();
  });

  it("advances offset after each update", async () => {
    const onUpdate = vi.fn();
    const monitor = new TelegramMonitor("tok", onUpdate);

    // First poll: returns update_id 10
    fetchSpy.mockResolvedValueOnce(mockTelegramResponse([makeUpdate(10)]));
    // Second poll: should use offset=11
    fetchSpy.mockResolvedValueOnce(mockTelegramResponse([]));

    monitor.start();
    await vi.advanceTimersByTimeAsync(600); // first poll
    await vi.advanceTimersByTimeAsync(600); // second poll

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchSpy.mock.calls[1]![1]?.body as string);
    expect(secondBody.offset).toBe(11);

    monitor.stop();
  });

  it("empty result array does not call onUpdate", async () => {
    const onUpdate = vi.fn();
    const monitor = new TelegramMonitor("tok", onUpdate);

    fetchSpy.mockResolvedValueOnce(mockTelegramResponse([]));

    monitor.start();
    await vi.advanceTimersByTimeAsync(600);

    expect(onUpdate).not.toHaveBeenCalled();

    monitor.stop();
  });

  it("stop() prevents further polling", async () => {
    const onUpdate = vi.fn();
    const monitor = new TelegramMonitor("tok", onUpdate);

    fetchSpy.mockResolvedValue(mockTelegramResponse([]));

    monitor.start();
    await vi.advanceTimersByTimeAsync(600); // first poll
    monitor.stop();

    const callsBefore = fetchSpy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000); // would have polled more

    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it("start() is idempotent when already running", async () => {
    const onUpdate = vi.fn();
    const monitor = new TelegramMonitor("tok", onUpdate);

    fetchSpy.mockResolvedValue(mockTelegramResponse([]));

    monitor.start();
    monitor.start(); // second call should be no-op

    await vi.advanceTimersByTimeAsync(600);
    // Only one poll should have happened (one timer scheduled)
    expect(fetchSpy).toHaveBeenCalledOnce();

    monitor.stop();
  });

  it("error in onUpdate does not crash the polling loop", async () => {
    const onUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error("handler boom"))
      .mockResolvedValue(undefined);

    const monitor = new TelegramMonitor("tok", onUpdate);

    // First poll: two updates, first handler throws
    fetchSpy.mockResolvedValueOnce(mockTelegramResponse([makeUpdate(1), makeUpdate(2)]));
    // Second poll: should still happen
    fetchSpy.mockResolvedValueOnce(mockTelegramResponse([]));

    monitor.start();
    await vi.advanceTimersByTimeAsync(600); // first poll

    // Both updates were attempted despite the first throwing
    expect(onUpdate).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(600); // second poll
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it("non-ok API response triggers backoff", async () => {
    const onUpdate = vi.fn();
    const monitor = new TelegramMonitor("tok", onUpdate);

    // First poll fails
    fetchSpy.mockResolvedValueOnce(mockTelegramResponse(null, false));
    // Second poll succeeds (after backoff)
    fetchSpy.mockResolvedValueOnce(mockTelegramResponse([]));

    monitor.start();
    await vi.advanceTimersByTimeAsync(600); // first poll (fails)

    // At 500ms backoff interval, second poll shouldn't have happened yet at 600ms
    // after the first poll. Backoff doubles to 1000ms.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1100); // wait for backoff
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    monitor.stop();
  });
});
