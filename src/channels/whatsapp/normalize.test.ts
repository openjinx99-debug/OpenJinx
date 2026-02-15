import { describe, expect, it } from "vitest";
import { normalizePhoneNumber, isValidJid } from "./normalize.js";

describe("normalizePhoneNumber", () => {
  it("adds + prefix if missing", () => {
    expect(normalizePhoneNumber("14155551234")).toBe("+14155551234");
  });

  it("preserves existing + prefix", () => {
    expect(normalizePhoneNumber("+14155551234")).toBe("+14155551234");
  });

  it("strips formatting characters", () => {
    expect(normalizePhoneNumber("+1 (415) 555-1234")).toBe("+14155551234");
  });

  it("strips dots and dashes", () => {
    expect(normalizePhoneNumber("1.415.555.1234")).toBe("+14155551234");
  });
});

describe("isValidJid", () => {
  it("accepts valid individual JID", () => {
    expect(isValidJid("14155551234@s.whatsapp.net")).toBe(true);
  });

  it("accepts valid group JID", () => {
    expect(isValidJid("1234567890-1678901234@g.us")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidJid("")).toBe(false);
  });

  it("rejects JID with wrong suffix", () => {
    expect(isValidJid("14155551234@example.com")).toBe(false);
  });

  it("rejects JID with too few digits", () => {
    expect(isValidJid("123@s.whatsapp.net")).toBe(false);
  });
});
