import { downloadMediaMessage } from "baileys";
import { createLogger } from "../../infra/logger.js";

const logger = createLogger("whatsapp:media");

/**
 * Download media from a raw WhatsApp message (Baileys proto.IWebMessageInfo).
 * Returns the media content as a Buffer.
 */
export async function downloadWhatsAppMedia(params: { message: unknown }): Promise<Buffer> {
  try {
    const buffer = await downloadMediaMessage(
      params.message as Parameters<typeof downloadMediaMessage>[0],
      "buffer",
      {},
    );
    logger.debug(`Downloaded WhatsApp media: ${(buffer as Buffer).length} bytes`);
    return buffer as Buffer;
  } catch (err) {
    logger.error(`Failed to download WhatsApp media: ${err}`);
    throw err;
  }
}

/**
 * Send media via WhatsApp through the Baileys socket.
 * Handles image, audio, video, and document types.
 */
export async function sendWhatsAppMedia(params: {
  socket: { sendMessage(jid: string, content: unknown): Promise<void> };
  jid: string;
  buffer: Buffer;
  type: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
}): Promise<void> {
  const { socket, jid, buffer, type, mimetype, filename, caption } = params;
  logger.debug(`Sending ${type} to ${jid} (${buffer.length} bytes)`);

  const content: Record<string, unknown> = {};

  switch (type) {
    case "image":
      content.image = buffer;
      content.mimetype = mimetype ?? "image/jpeg";
      break;
    case "audio":
      content.audio = buffer;
      content.mimetype = mimetype ?? "audio/ogg; codecs=opus";
      break;
    case "video":
      content.video = buffer;
      content.mimetype = mimetype ?? "video/mp4";
      break;
    default:
      content.document = buffer;
      content.mimetype = mimetype ?? "application/octet-stream";
      content.fileName = filename ?? "file";
      break;
  }

  if (caption) {
    content.caption = caption;
  }

  await socket.sendMessage(jid, content);
}
