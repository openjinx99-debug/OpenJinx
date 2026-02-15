import { describe, expect, it, vi } from "vitest";
import type { ChannelPlugin } from "../types/channels.js";
import type { ReplyPayload, DeliveryTarget } from "../types/messages.js";
import { deliverOutboundPayloads, type DeliveryDeps } from "./deliver.js";

function makeChannelPlugin(overrides: Partial<ChannelPlugin> = {}): ChannelPlugin {
  return {
    id: "terminal",
    name: "Terminal",
    capabilities: {
      markdown: true,
      images: false,
      audio: false,
      video: false,
      documents: false,
      reactions: false,
      editing: false,
      streaming: false,
      maxTextLength: 4096,
    },
    start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    send: vi.fn<() => Promise<string | undefined>>().mockResolvedValue("msg-1"),
    isReady: vi.fn(() => true),
    ...overrides,
  };
}

function makeDeps(channel?: ChannelPlugin): DeliveryDeps {
  return {
    getChannel: vi.fn((name: string) => (channel && name === channel.id ? channel : undefined)),
    chunkText: vi.fn((text: string, maxLength: number) => {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += maxLength) {
        chunks.push(text.slice(i, i + maxLength));
      }
      return chunks.length > 0 ? chunks : [text];
    }),
  };
}

const defaultTarget: DeliveryTarget = {
  channel: "terminal",
  to: "user-123",
};

describe("deliverOutboundPayloads", () => {
  it("returns error result when channel is not found", async () => {
    const deps = makeDeps(undefined);
    const payload: ReplyPayload = { text: "Hello" };

    const result = await deliverOutboundPayloads({
      payload,
      target: defaultTarget,
      deps,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Channel not found");
    expect(result.channel).toBe("terminal");
    expect(result.to).toBe("user-123");
    expect(result.textChunks).toBe(0);
    expect(result.mediaItems).toBe(0);
  });

  it("sends text payload as chunks", async () => {
    const channel = makeChannelPlugin();
    const deps = makeDeps(channel);
    const payload: ReplyPayload = { text: "Hello, world!" };

    const result = await deliverOutboundPayloads({
      payload,
      target: defaultTarget,
      deps,
    });

    expect(result.success).toBe(true);
    expect(result.textChunks).toBe(1);
    expect(result.mediaItems).toBe(0);
    expect(channel.send).toHaveBeenCalledOnce();
    expect(channel.send).toHaveBeenCalledWith("user-123", { text: "Hello, world!" });
  });

  it("chunks long text according to maxTextLength", async () => {
    const channel = makeChannelPlugin({
      capabilities: {
        markdown: true,
        images: false,
        audio: false,
        video: false,
        documents: false,
        reactions: false,
        editing: false,
        streaming: false,
        maxTextLength: 5,
      },
    });
    const deps = makeDeps(channel);
    const payload: ReplyPayload = { text: "ABCDEFGHIJ" }; // 10 chars, should be 2 chunks

    const result = await deliverOutboundPayloads({
      payload,
      target: defaultTarget,
      deps,
    });

    expect(result.success).toBe(true);
    expect(result.textChunks).toBe(2);
    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it("sends media items", async () => {
    const channel = makeChannelPlugin();
    const deps = makeDeps(channel);
    const payload: ReplyPayload = {
      media: [
        { type: "image", mimeType: "image/png", url: "https://example.com/img.png" },
        { type: "document", mimeType: "application/pdf", filename: "report.pdf" },
      ],
    };

    const result = await deliverOutboundPayloads({
      payload,
      target: defaultTarget,
      deps,
    });

    expect(result.success).toBe(true);
    expect(result.mediaItems).toBe(2);
    expect(result.textChunks).toBe(0);
    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it("sends both text and media", async () => {
    const channel = makeChannelPlugin();
    const deps = makeDeps(channel);
    const payload: ReplyPayload = {
      text: "Here is the report",
      media: [{ type: "document", mimeType: "application/pdf", filename: "report.pdf" }],
    };

    const result = await deliverOutboundPayloads({
      payload,
      target: defaultTarget,
      deps,
    });

    expect(result.success).toBe(true);
    expect(result.textChunks).toBe(1);
    expect(result.mediaItems).toBe(1);
    // text chunk + media item = 2 send calls
    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it("returns error result when channel.send throws", async () => {
    const channel = makeChannelPlugin({
      send: vi
        .fn<() => Promise<string | undefined>>()
        .mockRejectedValue(new Error("Network timeout")),
    });
    const deps = makeDeps(channel);
    const payload: ReplyPayload = { text: "Failing message" };

    const result = await deliverOutboundPayloads({
      payload,
      target: defaultTarget,
      deps,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network timeout");
  });

  it("handles payload with no text and no media", async () => {
    const channel = makeChannelPlugin();
    const deps = makeDeps(channel);
    const payload: ReplyPayload = {};

    const result = await deliverOutboundPayloads({
      payload,
      target: defaultTarget,
      deps,
    });

    expect(result.success).toBe(true);
    expect(result.textChunks).toBe(0);
    expect(result.mediaItems).toBe(0);
    expect(channel.send).not.toHaveBeenCalled();
  });
});
