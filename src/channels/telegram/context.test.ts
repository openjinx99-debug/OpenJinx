import { describe, expect, it } from "vitest";
import type { TelegramUpdate } from "./context.js";
import { telegramUpdateToContext, extractTelegramMedia } from "./context.js";

function makeUpdate(overrides: Partial<TelegramUpdate["message"]> = {}): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 100,
      from: { id: 42, first_name: "Alice", last_name: "Smith", username: "alice" },
      chat: { id: 42, type: "private" },
      text: "hello",
      date: 1700000000,
      ...overrides,
    },
  };
}

describe("telegramUpdateToContext", () => {
  it("converts a DM update to MsgContext", () => {
    const ctx = telegramUpdateToContext(makeUpdate());

    expect(ctx.channel).toBe("telegram");
    expect(ctx.senderId).toBe("42");
    expect(ctx.senderName).toBe("Alice Smith");
    expect(ctx.text).toBe("hello");
    expect(ctx.isGroup).toBe(false);
    expect(ctx.sessionKey).toBe("telegram:dm:42");
  });

  it("converts a group update", () => {
    const ctx = telegramUpdateToContext(
      makeUpdate({
        chat: { id: -100, type: "supergroup", title: "Dev Chat" },
      }),
    );

    expect(ctx.isGroup).toBe(true);
    expect(ctx.groupId).toBe("-100");
    expect(ctx.groupName).toBe("Dev Chat");
    expect(ctx.sessionKey).toBe("telegram:group:-100");
  });

  it("throws when update has no message", () => {
    expect(() => telegramUpdateToContext({ update_id: 1 })).toThrow("Update has no message field");
  });

  it("falls back to chat.id for senderId when from is missing", () => {
    const ctx = telegramUpdateToContext(
      makeUpdate({
        from: undefined,
      }),
    );

    expect(ctx.senderId).toBe("42");
    expect(ctx.senderName).toBe("Unknown");
  });

  it("parses /command args correctly", () => {
    const ctx = telegramUpdateToContext(makeUpdate({ text: "/start deep_link_arg" }));

    expect(ctx.isCommand).toBe(true);
    expect(ctx.commandName).toBe("start");
    expect(ctx.commandArgs).toBe("deep_link_arg");
  });

  it("parses command without args", () => {
    const ctx = telegramUpdateToContext(makeUpdate({ text: "/help" }));

    expect(ctx.isCommand).toBe(true);
    expect(ctx.commandName).toBe("help");
    expect(ctx.commandArgs).toBe("");
  });

  it("sets isCommand false for regular text", () => {
    const ctx = telegramUpdateToContext(makeUpdate({ text: "just a message" }));

    expect(ctx.isCommand).toBe(false);
    expect(ctx.commandName).toBeUndefined();
  });

  it("builds senderName from first_name only when last_name is absent", () => {
    const ctx = telegramUpdateToContext(
      makeUpdate({
        from: { id: 7, first_name: "Bob" },
      }),
    );

    expect(ctx.senderName).toBe("Bob");
  });

  it("stores raw update on context", () => {
    const update = makeUpdate();
    const ctx = telegramUpdateToContext(update);

    expect(ctx.raw).toBe(update);
  });

  it("throws when chat.id is not a number", () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 100,
        from: { id: 42, first_name: "Alice" },
        chat: { id: "not-a-number" as unknown as number, type: "private" },
        text: "hello",
        date: 1700000000,
      },
    };

    expect(() => telegramUpdateToContext(update)).toThrow("invalid or missing chat.id");
  });

  it("throws when chat is missing", () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 100,
        from: { id: 42, first_name: "Alice" },
        chat: undefined as unknown as { id: number; type: string },
        text: "hello",
        date: 1700000000,
      },
    };

    expect(() => telegramUpdateToContext(update)).toThrow("invalid or missing chat.id");
  });

  it("extracts media from photo message and uses caption as text", () => {
    const update = makeUpdate({
      text: undefined,
      caption: "Check this out",
      photo: [
        { file_id: "small", file_size: 1000, width: 90, height: 90 },
        { file_id: "large", file_size: 50000, width: 800, height: 600 },
      ],
    });
    const ctx = telegramUpdateToContext(update);

    expect(ctx.text).toBe("Check this out");
    expect(ctx.media).toHaveLength(1);
    expect(ctx.media![0].type).toBe("image");
    expect(ctx.media![0].mimeType).toBe("image/jpeg");
    expect(ctx.media![0].caption).toBe("Check this out");
  });

  it("extracts media from document message", () => {
    const update = makeUpdate({
      text: undefined,
      document: { file_id: "doc1", mime_type: "application/pdf", file_name: "report.pdf" },
    });
    const ctx = telegramUpdateToContext(update);

    expect(ctx.media).toHaveLength(1);
    expect(ctx.media![0].type).toBe("document");
    expect(ctx.media![0].mimeType).toBe("application/pdf");
    expect(ctx.media![0].filename).toBe("report.pdf");
  });

  it("treats image/* documents as image type", () => {
    const update = makeUpdate({
      text: undefined,
      caption: "HD photo",
      document: { file_id: "img1", mime_type: "image/png", file_name: "photo.png" },
    });
    const ctx = telegramUpdateToContext(update);

    expect(ctx.media).toHaveLength(1);
    expect(ctx.media![0].type).toBe("image");
    expect(ctx.media![0].mimeType).toBe("image/png");
  });

  it("sets empty text when no text or caption is present on media message", () => {
    const update = makeUpdate({
      text: undefined,
      photo: [{ file_id: "photo1", file_size: 1000 }],
    });
    const ctx = telegramUpdateToContext(update);

    expect(ctx.text).toBe("");
    expect(ctx.media).toHaveLength(1);
  });

  it("throws when from.id is not a number", () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 100,
        from: { id: "bad" as unknown as number, first_name: "Alice" },
        chat: { id: 42, type: "private" },
        text: "hello",
        date: 1700000000,
      },
    };

    expect(() => telegramUpdateToContext(update)).toThrow("invalid from.id");
  });
});

describe("extractTelegramMedia", () => {
  it("picks the largest photo from the array", () => {
    const msg = {
      message_id: 1,
      chat: { id: 1, type: "private" },
      date: 1,
      photo: [
        { file_id: "small", file_size: 1000, width: 90, height: 90 },
        { file_id: "medium", file_size: 10000, width: 320, height: 240 },
        { file_id: "large", file_size: 50000, width: 800, height: 600 },
      ],
    };
    const { media, fileIds } = extractTelegramMedia(msg);

    expect(media).toHaveLength(1);
    expect(fileIds).toEqual(["large"]);
    expect(media[0].type).toBe("image");
    expect(media[0].mimeType).toBe("image/jpeg");
  });

  it("extracts voice messages as audio", () => {
    const msg = {
      message_id: 1,
      chat: { id: 1, type: "private" },
      date: 1,
      voice: { file_id: "voice1", mime_type: "audio/ogg", duration: 5 },
    };
    const { media, fileIds } = extractTelegramMedia(msg);

    expect(media).toHaveLength(1);
    expect(fileIds).toEqual(["voice1"]);
    expect(media[0].type).toBe("audio");
    expect(media[0].mimeType).toBe("audio/ogg");
  });

  it("extracts sticker with emoji caption", () => {
    const msg = {
      message_id: 1,
      chat: { id: 1, type: "private" },
      date: 1,
      sticker: { file_id: "sticker1", emoji: "😀", is_animated: false },
    };
    const { media } = extractTelegramMedia(msg);

    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("sticker");
    expect(media[0].mimeType).toBe("image/webp");
    expect(media[0].caption).toBe("Sticker: 😀");
  });

  it("returns empty arrays for text-only messages", () => {
    const msg = {
      message_id: 1,
      chat: { id: 1, type: "private" },
      date: 1,
      text: "hello",
    };
    const { media, fileIds } = extractTelegramMedia(msg);

    expect(media).toHaveLength(0);
    expect(fileIds).toHaveLength(0);
  });
});
