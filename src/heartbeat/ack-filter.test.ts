import { describe, it, expect } from "vitest";
import { isAcknowledgment } from "./ack-filter.js";

describe("isAcknowledgment", () => {
  it("treats short text as acknowledgment", () => {
    expect(isAcknowledgment("All clear, nothing needed.")).toBe(true);
  });

  it("treats empty string as acknowledgment", () => {
    expect(isAcknowledgment("")).toBe(true);
  });

  it("treats text at exactly maxChars as not an acknowledgment", () => {
    const text = "x".repeat(300);
    expect(isAcknowledgment(text)).toBe(false);
  });

  it("treats text above maxChars as not an acknowledgment", () => {
    const text = "x".repeat(500);
    expect(isAcknowledgment(text)).toBe(false);
  });

  it("treats text just below maxChars as acknowledgment", () => {
    const text = "x".repeat(299);
    expect(isAcknowledgment(text)).toBe(true);
  });

  it("respects custom maxChars threshold", () => {
    expect(isAcknowledgment("Hello world", 5)).toBe(false);
    expect(isAcknowledgment("Hi", 5)).toBe(true);
  });
});
