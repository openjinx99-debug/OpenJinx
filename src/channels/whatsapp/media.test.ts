import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("baileys", () => ({
  downloadMediaMessage: vi.fn(),
}));

describe("downloadWhatsAppMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads media and returns buffer", async () => {
    const { downloadMediaMessage } = await import("baileys");
    const { downloadWhatsAppMedia } = await import("./media.js");

    const fakeBuffer = Buffer.from("fake-image-data");
    vi.mocked(downloadMediaMessage).mockResolvedValue(fakeBuffer);

    const result = await downloadWhatsAppMedia({ message: { key: {}, message: {} } });

    expect(result).toEqual(fakeBuffer);
    expect(downloadMediaMessage).toHaveBeenCalledWith({ key: {}, message: {} }, "buffer", {});
  });

  it("throws on download failure", async () => {
    const { downloadMediaMessage } = await import("baileys");
    const { downloadWhatsAppMedia } = await import("./media.js");

    vi.mocked(downloadMediaMessage).mockRejectedValue(new Error("network error"));

    await expect(downloadWhatsAppMedia({ message: {} })).rejects.toThrow("network error");
  });
});

describe("sendWhatsAppMedia", () => {
  it("sends image with correct content shape", async () => {
    const { sendWhatsAppMedia } = await import("./media.js");

    const mockSocket = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const buffer = Buffer.from("image-data");

    await sendWhatsAppMedia({
      socket: mockSocket,
      jid: "123@s.whatsapp.net",
      buffer,
      type: "image",
      mimetype: "image/png",
      caption: "test image",
    });

    expect(mockSocket.sendMessage).toHaveBeenCalledWith("123@s.whatsapp.net", {
      image: buffer,
      mimetype: "image/png",
      caption: "test image",
    });
  });

  it("sends document with filename", async () => {
    const { sendWhatsAppMedia } = await import("./media.js");

    const mockSocket = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const buffer = Buffer.from("doc-data");

    await sendWhatsAppMedia({
      socket: mockSocket,
      jid: "123@s.whatsapp.net",
      buffer,
      type: "document",
      mimetype: "application/pdf",
      filename: "report.pdf",
    });

    expect(mockSocket.sendMessage).toHaveBeenCalledWith("123@s.whatsapp.net", {
      document: buffer,
      mimetype: "application/pdf",
      fileName: "report.pdf",
    });
  });

  it("sends audio with default mimetype", async () => {
    const { sendWhatsAppMedia } = await import("./media.js");

    const mockSocket = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const buffer = Buffer.from("audio-data");

    await sendWhatsAppMedia({
      socket: mockSocket,
      jid: "123@s.whatsapp.net",
      buffer,
      type: "audio",
    });

    expect(mockSocket.sendMessage).toHaveBeenCalledWith("123@s.whatsapp.net", {
      audio: buffer,
      mimetype: "audio/ogg; codecs=opus",
    });
  });

  it("sends video with caption", async () => {
    const { sendWhatsAppMedia } = await import("./media.js");

    const mockSocket = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const buffer = Buffer.from("video-data");

    await sendWhatsAppMedia({
      socket: mockSocket,
      jid: "123@s.whatsapp.net",
      buffer,
      type: "video",
      mimetype: "video/mp4",
      caption: "cool video",
    });

    expect(mockSocket.sendMessage).toHaveBeenCalledWith("123@s.whatsapp.net", {
      video: buffer,
      mimetype: "video/mp4",
      caption: "cool video",
    });
  });
});
