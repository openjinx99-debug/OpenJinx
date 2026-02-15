import { describe, expect, it } from "vitest";
import { checkWhatsAppAccess } from "./access.js";

describe("checkWhatsAppAccess", () => {
  describe("DM policy", () => {
    it("allows DMs when policy is open", () => {
      expect(
        checkWhatsAppAccess({
          jid: "1234@s.whatsapp.net",
          isGroup: false,
          dmPolicy: "open",
        }),
      ).toBe(true);
    });

    it("denies DMs when policy is disabled", () => {
      expect(
        checkWhatsAppAccess({
          jid: "1234@s.whatsapp.net",
          isGroup: false,
          dmPolicy: "disabled",
        }),
      ).toBe(false);
    });

    it("allows DMs from allowlist when policy is allowlist", () => {
      expect(
        checkWhatsAppAccess({
          jid: "1234@s.whatsapp.net",
          isGroup: false,
          dmPolicy: "allowlist",
          allowFrom: ["1234@s.whatsapp.net"],
        }),
      ).toBe(true);
    });

    it("denies DMs not on allowlist when policy is allowlist", () => {
      expect(
        checkWhatsAppAccess({
          jid: "1234@s.whatsapp.net",
          isGroup: false,
          dmPolicy: "allowlist",
          allowFrom: ["5678@s.whatsapp.net"],
        }),
      ).toBe(false);
    });

    it("denies DMs when allowlist policy but no allowFrom provided", () => {
      expect(
        checkWhatsAppAccess({
          jid: "1234@s.whatsapp.net",
          isGroup: false,
          dmPolicy: "allowlist",
        }),
      ).toBe(false);
    });

    it("denies DMs with unknown policy", () => {
      expect(
        checkWhatsAppAccess({
          jid: "1234@s.whatsapp.net",
          isGroup: false,
          dmPolicy: "unknown",
        }),
      ).toBe(false);
    });
  });

  describe("group policy", () => {
    it("denies groups when policy is disabled", () => {
      expect(
        checkWhatsAppAccess({
          jid: "group-id@g.us",
          isGroup: true,
          dmPolicy: "open",
          groupPolicy: "disabled",
        }),
      ).toBe(false);
    });

    it("allows groups when policy is not disabled and no allowlist", () => {
      expect(
        checkWhatsAppAccess({
          jid: "group-id@g.us",
          isGroup: true,
          dmPolicy: "open",
          groupPolicy: "enabled",
        }),
      ).toBe(true);
    });

    it("allows groups on the allowlist", () => {
      expect(
        checkWhatsAppAccess({
          jid: "group-id@g.us",
          isGroup: true,
          dmPolicy: "open",
          groupPolicy: "enabled",
          allowFrom: ["group-id@g.us"],
        }),
      ).toBe(true);
    });

    it("denies groups not on the allowlist", () => {
      expect(
        checkWhatsAppAccess({
          jid: "group-id@g.us",
          isGroup: true,
          dmPolicy: "open",
          groupPolicy: "enabled",
          allowFrom: ["other-group@g.us"],
        }),
      ).toBe(false);
    });
  });
});
