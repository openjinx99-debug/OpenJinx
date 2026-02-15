import { describe, expect, it } from "vitest";
import { checkTelegramAccess } from "./access.js";

describe("checkTelegramAccess", () => {
  it("allows open DM policy", () => {
    expect(checkTelegramAccess({ chatId: 123, isGroup: false, dmPolicy: "open" })).toBe(true);
  });

  it("rejects disabled DM policy", () => {
    expect(checkTelegramAccess({ chatId: 123, isGroup: false, dmPolicy: "disabled" })).toBe(false);
  });

  it("allows allowlisted chat in allowlist DM policy", () => {
    expect(
      checkTelegramAccess({
        chatId: 123,
        isGroup: false,
        dmPolicy: "allowlist",
        allowedChatIds: [123],
      }),
    ).toBe(true);
  });

  it("rejects non-allowlisted chat in allowlist DM policy", () => {
    expect(
      checkTelegramAccess({
        chatId: 999,
        isGroup: false,
        dmPolicy: "allowlist",
        allowedChatIds: [123],
      }),
    ).toBe(false);
  });

  it("allows groups with allowed chat ID", () => {
    expect(
      checkTelegramAccess({
        chatId: -100,
        isGroup: true,
        dmPolicy: "open",
        allowedChatIds: [-100],
      }),
    ).toBe(true);
  });

  it("rejects groups without allowed chat IDs", () => {
    expect(checkTelegramAccess({ chatId: -100, isGroup: true, dmPolicy: "open" })).toBe(false);
  });

  it("rejects groups when groupPolicy is disabled", () => {
    expect(
      checkTelegramAccess({
        chatId: -100,
        isGroup: true,
        dmPolicy: "open",
        groupPolicy: "disabled",
        allowedChatIds: [-100],
      }),
    ).toBe(false);
  });

  it("allows groups when groupPolicy is enabled and chat ID is allowed", () => {
    expect(
      checkTelegramAccess({
        chatId: -100,
        isGroup: true,
        dmPolicy: "open",
        groupPolicy: "enabled",
        allowedChatIds: [-100],
      }),
    ).toBe(true);
  });
});
