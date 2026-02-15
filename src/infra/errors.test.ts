import { describe, expect, it } from "vitest";
import { formatError, formatErrorWithStack, withContext } from "./errors.js";

describe("formatError", () => {
  it("formats Error instances", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
  });

  it("formats strings", () => {
    expect(formatError("oops")).toBe("oops");
  });

  it("formats other types", () => {
    expect(formatError(42)).toBe("42");
    expect(formatError(null)).toBe("null");
  });
});

describe("formatErrorWithStack", () => {
  it("includes stack trace for Error instances", () => {
    const err = new Error("boom");
    const result = formatErrorWithStack(err);
    expect(result).toContain("boom");
    expect(result).toContain("errors.test");
  });

  it("falls back to formatError for non-Error", () => {
    expect(formatErrorWithStack("oops")).toBe("oops");
  });
});

describe("withContext", () => {
  it("passes through successful results", async () => {
    const result = await withContext("test", async () => 42);
    expect(result).toBe(42);
  });

  it("wraps errors with context label", async () => {
    await expect(
      withContext("loading config", async () => {
        throw new Error("file not found");
      }),
    ).rejects.toThrow("loading config: file not found");
  });
});
