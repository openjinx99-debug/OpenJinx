import { describe, expect, it } from "vitest";
import { withTimeout } from "./timeout.js";

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000, "timed out");
    expect(result).toBe("ok");
  });

  it("rejects with message when promise exceeds timeout", async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10, "too slow")).rejects.toThrow("too slow");
  });

  it("returns promise as-is when ms <= 0", async () => {
    const p = Promise.resolve(42);
    const result = await withTimeout(p, 0, "ignored");
    expect(result).toBe(42);

    const result2 = await withTimeout(Promise.resolve(99), -1, "ignored");
    expect(result2).toBe(99);
  });

  it("preserves original rejection if promise rejects before timeout", async () => {
    const failing = Promise.reject(new Error("original error"));
    await expect(withTimeout(failing, 1000, "timeout msg")).rejects.toThrow("original error");
  });
});
