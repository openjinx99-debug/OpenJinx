import { describe, expect, it } from "vitest";
import type { WhatsAppMessage } from "./context.js";
import { whatsappMessageToContext, extractMediaAttachments } from "./context.js";

function makeMsg(overrides?: Partial<WhatsAppMessage>): WhatsAppMessage {
  return {
    key: {
      remoteJid: "1234567890@s.whatsapp.net",
      fromMe: false,
      id: "msg-001",
    },
    message: {
      conversation: "hello world",
    },
    pushName: "Alice",
    messageTimestamp: 1700000000,
    ...overrides,
  };
}

describe("whatsappMessageToContext", () => {
  it("converts a DM message to MsgContext", () => {
    const ctx = whatsappMessageToContext(makeMsg());

    expect(ctx.channel).toBe("whatsapp");
    expect(ctx.messageId).toBe("msg-001");
    expect(ctx.senderId).toBe("1234567890@s.whatsapp.net");
    expect(ctx.senderName).toBe("Alice");
    expect(ctx.text).toBe("hello world");
    expect(ctx.isGroup).toBe(false);
    expect(ctx.groupId).toBeUndefined();
  });

  it("detects group messages via @g.us suffix", () => {
    const ctx = whatsappMessageToContext(
      makeMsg({
        key: {
          remoteJid: "120363001@g.us",
          fromMe: false,
          id: "msg-002",
          participant: "5551234@s.whatsapp.net",
        },
      }),
    );

    expect(ctx.isGroup).toBe(true);
    expect(ctx.groupId).toBe("120363001@g.us");
    expect(ctx.senderId).toBe("5551234@s.whatsapp.net");
  });

  it("extracts text from extendedTextMessage", () => {
    const ctx = whatsappMessageToContext(
      makeMsg({
        message: {
          extendedTextMessage: { text: "extended text" },
        },
      }),
    );

    expect(ctx.text).toBe("extended text");
  });

  it("falls back to empty text when no message content", () => {
    const ctx = whatsappMessageToContext(
      makeMsg({
        message: {},
      }),
    );

    expect(ctx.text).toBe("");
  });

  it("falls back to JID when pushName is missing", () => {
    const ctx = whatsappMessageToContext(makeMsg({ pushName: undefined }));

    expect(ctx.senderName).toBe("1234567890@s.whatsapp.net");
  });

  it("generates correct session key for DM", () => {
    const ctx = whatsappMessageToContext(makeMsg());

    expect(ctx.sessionKey).toBe("whatsapp:dm:1234567890@s.whatsapp.net");
  });

  it("generates correct session key for group", () => {
    const ctx = whatsappMessageToContext(
      makeMsg({
        key: {
          remoteJid: "120363001@g.us",
          fromMe: false,
          id: "msg-003",
          participant: "5551234@s.whatsapp.net",
        },
      }),
    );

    expect(ctx.sessionKey).toBe("whatsapp:group:120363001@g.us");
  });

  it("includes media attachments in context when present", () => {
    const ctx = whatsappMessageToContext(
      makeMsg({
        message: {
          imageMessage: { mimetype: "image/png", caption: "my photo", fileLength: 12345 },
        },
      }),
    );

    expect(ctx.media).toHaveLength(1);
    expect(ctx.media![0]).toEqual({
      type: "image",
      mimeType: "image/png",
      caption: "my photo",
      sizeBytes: 12345,
    });
  });

  it("omits media from context when no media message fields present", () => {
    const ctx = whatsappMessageToContext(makeMsg());

    expect(ctx.media).toBeUndefined();
  });
});

describe("extractMediaAttachments", () => {
  it("extracts image attachment", () => {
    const attachments = extractMediaAttachments(
      makeMsg({
        message: { imageMessage: { mimetype: "image/jpeg", caption: "pic", fileLength: 1000 } },
      }),
    );

    expect(attachments).toEqual([
      { type: "image", mimeType: "image/jpeg", caption: "pic", sizeBytes: 1000 },
    ]);
  });

  it("extracts audio attachment", () => {
    const attachments = extractMediaAttachments(
      makeMsg({
        message: { audioMessage: { mimetype: "audio/mp4", seconds: 30, ptt: true } },
      }),
    );

    expect(attachments).toEqual([{ type: "audio", mimeType: "audio/mp4" }]);
  });

  it("extracts video attachment", () => {
    const attachments = extractMediaAttachments(
      makeMsg({
        message: { videoMessage: { mimetype: "video/mp4", caption: "vid", fileLength: 5000 } },
      }),
    );

    expect(attachments).toEqual([
      { type: "video", mimeType: "video/mp4", caption: "vid", sizeBytes: 5000 },
    ]);
  });

  it("extracts document attachment", () => {
    const attachments = extractMediaAttachments(
      makeMsg({
        message: {
          documentMessage: {
            mimetype: "application/pdf",
            fileName: "report.pdf",
            fileLength: 2048,
          },
        },
      }),
    );

    expect(attachments).toEqual([
      {
        type: "document",
        mimeType: "application/pdf",
        filename: "report.pdf",
        sizeBytes: 2048,
      },
    ]);
  });

  it("returns empty array for text-only messages", () => {
    const attachments = extractMediaAttachments(makeMsg());
    expect(attachments).toEqual([]);
  });

  it("returns empty array when message is undefined", () => {
    const attachments = extractMediaAttachments(
      makeMsg({ message: undefined } as unknown as Partial<WhatsAppMessage>),
    );
    expect(attachments).toEqual([]);
  });

  it("uses default mimetypes when not provided", () => {
    const attachments = extractMediaAttachments(makeMsg({ message: { imageMessage: {} } }));
    expect(attachments[0].mimeType).toBe("image/jpeg");
  });
});
