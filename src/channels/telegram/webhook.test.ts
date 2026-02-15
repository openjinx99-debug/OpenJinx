import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TelegramUpdate } from "./context.js";
import { parseTelegramWebhookRequest } from "./webhook.js";

describe("parseTelegramWebhookRequest", () => {
  const validUpdate: TelegramUpdate = {
    update_id: 12345,
    message: {
      message_id: 1,
      from: { id: 100, first_name: "Test" },
      chat: { id: 100, type: "private" },
      text: "hello",
      date: Math.floor(Date.now() / 1000),
    },
  };

  it("parses a valid webhook body without secret token", () => {
    const result = parseTelegramWebhookRequest(JSON.stringify(validUpdate), {});
    expect(result).toEqual(validUpdate);
  });

  it("accepts matching secret token", () => {
    const result = parseTelegramWebhookRequest(
      JSON.stringify(validUpdate),
      { "x-telegram-bot-api-secret-token": "my-secret" },
      "my-secret",
    );
    expect(result).toEqual(validUpdate);
  });

  it("rejects mismatched secret token", () => {
    const result = parseTelegramWebhookRequest(
      JSON.stringify(validUpdate),
      { "x-telegram-bot-api-secret-token": "wrong-secret" },
      "my-secret",
    );
    expect(result).toBeNull();
  });

  it("rejects missing secret token when required", () => {
    const result = parseTelegramWebhookRequest(JSON.stringify(validUpdate), {}, "my-secret");
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const result = parseTelegramWebhookRequest("not json", {});
    expect(result).toBeNull();
  });
});

describe("registerTelegramWebhook", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls setWebhook API with correct params", async () => {
    const mockResp = {
      ok: true,
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve(""),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResp as Response);

    const { registerTelegramWebhook } = await import("./webhook.js");

    await registerTelegramWebhook({
      enabled: true,
      botToken: "123:ABC",
      webhookUrl: "https://example.com/telegram/webhook",
      secretToken: "secret-123",
      mode: "webhook",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.telegram.org/bot123:ABC/setWebhook",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"secret_token":"secret-123"'),
      }),
    );
  });

  it("throws on API failure", async () => {
    const mockResp = {
      ok: false,
      status: 400,
      text: () => Promise.resolve("Bad Request"),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResp as Response);

    const { registerTelegramWebhook } = await import("./webhook.js");

    await expect(
      registerTelegramWebhook({
        enabled: true,
        botToken: "123:ABC",
        webhookUrl: "https://example.com/webhook",
        mode: "webhook",
      }),
    ).rejects.toThrow("setWebhook failed");
  });
});
