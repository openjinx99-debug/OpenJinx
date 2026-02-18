import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../delivery/dead-letter.js", () => ({
  getDeadLetterPaths: vi.fn(() => ["/tmp/.jinx/delivery/dead-letter.jsonl"]),
  readDeadLetterEntries: vi.fn(),
  summarizeDeadLetters: vi.fn(),
  readDeadLetterReplayRecords: vi.fn(),
  appendDeadLetterReplayRecord: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../config/validation.js", () => ({
  loadAndValidateConfig: vi.fn(),
}));

vi.mock("../../channels/telegram/send.js", () => ({
  sendMessageTelegram: vi.fn().mockResolvedValue(123),
}));

vi.mock("../../channels/whatsapp/session.js", () => ({
  createWhatsAppSession: vi.fn(),
}));

vi.mock("../../channels/whatsapp/send.js", () => ({
  sendMessageWhatsApp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../infra/product-telemetry.js", () => ({
  logProductTelemetry: vi.fn(),
}));

const sampleDeadLetter = {
  id: "dl-abc123",
  timestamp: 1_700_000_000_000,
  source: "deep-work",
  reason: "completion",
  attempts: 3,
  error: "channel down",
  target: { channel: "telegram" as const, to: "12345" },
  payload: { text: "hello world", media: [] },
};

describe("deliveryCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("status prints summary", async () => {
    const dl = await import("../../delivery/dead-letter.js");
    vi.mocked(dl.readDeadLetterEntries).mockResolvedValue([sampleDeadLetter]);
    vi.mocked(dl.summarizeDeadLetters).mockReturnValue({
      total: 1,
      oldestTimestamp: sampleDeadLetter.timestamp,
      latestTimestamp: sampleDeadLetter.timestamp,
      bySource: { "deep-work": 1 },
      byChannel: { telegram: 1 },
      byReason: { completion: 1 },
    });

    const { deliveryCommand } = await import("./delivery.js");
    await deliveryCommand.parseAsync(["node", "delivery", "status"]);

    expect(dl.readDeadLetterEntries).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Total dead letters: 1"));
  });

  it("list marks entries already replayed", async () => {
    const dl = await import("../../delivery/dead-letter.js");
    vi.mocked(dl.readDeadLetterEntries).mockResolvedValue([sampleDeadLetter]);
    vi.mocked(dl.readDeadLetterReplayRecords).mockResolvedValue([
      {
        timestamp: Date.now(),
        deadLetterId: sampleDeadLetter.id,
        status: "success",
        channel: "telegram",
        to: "12345",
      },
    ]);

    const { deliveryCommand } = await import("./delivery.js");
    await deliveryCommand.parseAsync(["node", "delivery", "list", "--limit", "5"]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("replayed"));
  });

  it("replay dry-run logs preview and does not send", async () => {
    const dl = await import("../../delivery/dead-letter.js");
    const telegram = await import("../../channels/telegram/send.js");
    vi.mocked(dl.readDeadLetterEntries).mockResolvedValue([sampleDeadLetter]);
    vi.mocked(dl.readDeadLetterReplayRecords).mockResolvedValue([]);

    const { deliveryCommand } = await import("./delivery.js");
    await deliveryCommand.parseAsync([
      "node",
      "delivery",
      "replay",
      sampleDeadLetter.id,
      "--dry-run",
    ]);

    expect(telegram.sendMessageTelegram).not.toHaveBeenCalled();
    expect(dl.appendDeadLetterReplayRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        deadLetterId: sampleDeadLetter.id,
        status: "dry-run",
      }),
    );
  });

  it("replay sends telegram message and appends success record", async () => {
    const dl = await import("../../delivery/dead-letter.js");
    const config = await import("../../config/validation.js");
    const telegram = await import("../../channels/telegram/send.js");
    vi.mocked(dl.readDeadLetterEntries).mockResolvedValue([sampleDeadLetter]);
    vi.mocked(dl.readDeadLetterReplayRecords).mockResolvedValue([]);
    vi.mocked(config.loadAndValidateConfig).mockResolvedValue({
      channels: {
        telegram: {
          enabled: true,
          botToken: "token",
        },
        whatsapp: {
          enabled: false,
        },
      },
    } as never);

    const { deliveryCommand } = await import("./delivery.js");
    await deliveryCommand.parseAsync(["node", "delivery", "replay", sampleDeadLetter.id]);

    expect(telegram.sendMessageTelegram).toHaveBeenCalledWith(
      expect.objectContaining({
        botToken: "token",
        chatId: "12345",
      }),
    );
    expect(dl.appendDeadLetterReplayRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        deadLetterId: sampleDeadLetter.id,
        status: "success",
      }),
    );
  });

  it("replay blocks duplicate successful replay unless forced", async () => {
    const dl = await import("../../delivery/dead-letter.js");
    const telegram = await import("../../channels/telegram/send.js");
    vi.mocked(dl.readDeadLetterEntries).mockResolvedValue([sampleDeadLetter]);
    vi.mocked(dl.readDeadLetterReplayRecords).mockResolvedValue([
      {
        timestamp: Date.now(),
        deadLetterId: sampleDeadLetter.id,
        status: "success",
        channel: "telegram",
        to: "12345",
      },
    ]);

    const { deliveryCommand } = await import("./delivery.js");
    await deliveryCommand.parseAsync(["node", "delivery", "replay", sampleDeadLetter.id]);

    expect(telegram.sendMessageTelegram).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
