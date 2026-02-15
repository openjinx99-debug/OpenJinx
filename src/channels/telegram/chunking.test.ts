import { describe, expect, it } from "vitest";
import { chunkTelegramText } from "./chunking.js";

describe("chunkTelegramText", () => {
  it("returns single chunk for short text", () => {
    const chunks = chunkTelegramText("hello world", 100);
    expect(chunks).toEqual(["hello world"]);
  });

  it("splits on paragraph boundaries", () => {
    const paragraph1 = "A".repeat(80);
    const paragraph2 = "B".repeat(80);
    const text = `${paragraph1}\n\n${paragraph2}`;
    const chunks = chunkTelegramText(text, 100);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(paragraph1);
    expect(chunks[1]).toBe(paragraph2);
  });

  it("respects default max length of 4000", () => {
    const longText = "A".repeat(8000);
    const chunks = chunkTelegramText(longText);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves all content across chunks", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`).join("\n\n");
    const chunks = chunkTelegramText(text, 200);
    const reassembled = chunks.join("\n\n");
    // All lines should be present
    for (let i = 1; i <= 50; i++) {
      expect(reassembled).toContain(`Line ${i}`);
    }
  });
});
