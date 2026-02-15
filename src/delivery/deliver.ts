import type { ChannelPlugin } from "../types/channels.js";
import type { ReplyPayload, DeliveryTarget, OutboundMedia } from "../types/messages.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("delivery");

export interface DeliveryResult {
  channel: string;
  to: string;
  textChunks: number;
  mediaItems: number;
  success: boolean;
  error?: string;
}

export interface DeliveryDeps {
  getChannel: (name: string) => ChannelPlugin | undefined;
  chunkText: (text: string, maxLength: number) => string[];
}

/**
 * Universal outbound delivery: send a reply payload to a delivery target.
 * Handles chunking and media delivery.
 */
export async function deliverOutboundPayloads(params: {
  payload: ReplyPayload;
  target: DeliveryTarget;
  deps: DeliveryDeps;
}): Promise<DeliveryResult> {
  const { payload, target, deps } = params;

  const channel = deps.getChannel(target.channel);
  if (!channel) {
    return {
      channel: target.channel,
      to: target.to,
      textChunks: 0,
      mediaItems: 0,
      success: false,
      error: `Channel not found: ${target.channel}`,
    };
  }

  try {
    // 1. Send text chunks
    let textChunks = 0;
    if (payload.text) {
      const maxLen = channel.capabilities.maxTextLength;
      const chunks = deps.chunkText(payload.text, maxLen);
      for (const chunk of chunks) {
        await channel.send(target.to, { text: chunk });
        textChunks++;
      }
    }

    // 2. Send media items
    let mediaItems = 0;
    if (payload.media && payload.media.length > 0) {
      for (const item of payload.media) {
        await sendMediaItem(channel, target, item);
        mediaItems++;
      }
    }

    logger.debug(
      `Delivered to ${target.channel}:${target.to} (${textChunks} chunks, ${mediaItems} media)`,
    );

    return {
      channel: target.channel,
      to: target.to,
      textChunks,
      mediaItems,
      success: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Delivery failed: ${msg}`);
    return {
      channel: target.channel,
      to: target.to,
      textChunks: 0,
      mediaItems: 0,
      success: false,
      error: msg,
    };
  }
}

async function sendMediaItem(
  channel: ChannelPlugin,
  target: DeliveryTarget,
  item: OutboundMedia,
): Promise<void> {
  await channel.send(target.to, { media: [item] });
}
