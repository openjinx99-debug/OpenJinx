import type { MsgContext, MediaAttachment } from "../../types/messages.js";
import { buildMsgContext } from "../../pipeline/context.js";

/** Minimal WhatsApp message shape (Baileys proto.IWebMessageInfo). */
export interface WhatsAppMessage {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
    participant?: string;
  };
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { mimetype?: string; caption?: string; fileLength?: number };
    audioMessage?: { mimetype?: string; seconds?: number; ptt?: boolean };
    videoMessage?: { mimetype?: string; caption?: string; fileLength?: number };
    documentMessage?: { mimetype?: string; fileName?: string; fileLength?: number };
  };
  pushName?: string;
  messageTimestamp?: number;
}

/**
 * Extract media attachment metadata from a WhatsApp message.
 * Does not download the media — just records what's present.
 */
export function extractMediaAttachments(msg: WhatsAppMessage): MediaAttachment[] {
  const m = msg.message;
  if (!m) {
    return [];
  }

  const attachments: MediaAttachment[] = [];

  if (m.imageMessage) {
    attachments.push({
      type: "image",
      mimeType: m.imageMessage.mimetype ?? "image/jpeg",
      caption: m.imageMessage.caption,
      sizeBytes: m.imageMessage.fileLength,
    });
  }

  if (m.audioMessage) {
    attachments.push({
      type: "audio",
      mimeType: m.audioMessage.mimetype ?? "audio/ogg; codecs=opus",
    });
  }

  if (m.videoMessage) {
    attachments.push({
      type: "video",
      mimeType: m.videoMessage.mimetype ?? "video/mp4",
      caption: m.videoMessage.caption,
      sizeBytes: m.videoMessage.fileLength,
    });
  }

  if (m.documentMessage) {
    attachments.push({
      type: "document",
      mimeType: m.documentMessage.mimetype ?? "application/octet-stream",
      filename: m.documentMessage.fileName,
      sizeBytes: m.documentMessage.fileLength,
    });
  }

  return attachments;
}

/**
 * Transform a raw WhatsApp message into a unified MsgContext.
 */
export function whatsappMessageToContext(msg: WhatsAppMessage): MsgContext {
  const jid = msg.key.remoteJid;
  const isGroup = jid.endsWith("@g.us");
  const senderId = isGroup ? (msg.key.participant ?? jid) : jid;

  const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? "";
  const media = extractMediaAttachments(msg);

  return buildMsgContext({
    messageId: msg.key.id,
    channel: "whatsapp",
    text,
    senderId,
    senderName: msg.pushName ?? senderId,
    accountId: jid,
    isGroup,
    groupId: isGroup ? jid : undefined,
    media: media.length > 0 ? media : undefined,
    raw: msg,
  });
}
