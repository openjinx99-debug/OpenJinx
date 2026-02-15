import type { MediaAttachment, MsgContext } from "../../types/messages.js";
import { buildMsgContext } from "../../pipeline/context.js";

/** Minimal Telegram Update shape used by the context builder. */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; last_name?: string; username?: string };
    chat: { id: number; type: string; title?: string };
    text?: string;
    caption?: string;
    date: number;
    photo?: { file_id: string; file_size?: number; width?: number; height?: number }[];
    document?: { file_id: string; mime_type?: string; file_name?: string; file_size?: number };
    audio?: { file_id: string; mime_type?: string; duration?: number; file_size?: number };
    video?: { file_id: string; mime_type?: string; duration?: number; file_size?: number };
    voice?: { file_id: string; mime_type?: string; duration?: number; file_size?: number };
    sticker?: { file_id: string; emoji?: string; is_animated?: boolean };
  };
}

/**
 * Extract media attachments from a Telegram update message.
 */
export function extractTelegramMedia(msg: NonNullable<TelegramUpdate["message"]>): {
  media: MediaAttachment[];
  fileIds: string[];
} {
  const media: MediaAttachment[] = [];
  const fileIds: string[] = [];

  if (msg.photo && msg.photo.length > 0) {
    // Pick the largest photo (last in the array)
    const largest = msg.photo[msg.photo.length - 1];
    media.push({
      type: "image",
      mimeType: "image/jpeg", // Telegram always converts photos to JPEG
      sizeBytes: largest.file_size,
      caption: msg.caption,
    });
    fileIds.push(largest.file_id);
  }

  if (msg.document) {
    const isImage = msg.document.mime_type?.startsWith("image/") ?? false;
    media.push({
      type: isImage ? "image" : "document",
      mimeType: msg.document.mime_type ?? "application/octet-stream",
      filename: msg.document.file_name,
      sizeBytes: msg.document.file_size,
      caption: msg.caption,
    });
    fileIds.push(msg.document.file_id);
  }

  if (msg.audio) {
    media.push({
      type: "audio",
      mimeType: msg.audio.mime_type ?? "audio/mpeg",
      sizeBytes: msg.audio.file_size,
      caption: msg.caption,
    });
    fileIds.push(msg.audio.file_id);
  }

  if (msg.voice) {
    media.push({
      type: "audio",
      mimeType: msg.voice.mime_type ?? "audio/ogg",
      sizeBytes: msg.voice.file_size,
      caption: msg.caption,
    });
    fileIds.push(msg.voice.file_id);
  }

  if (msg.video) {
    media.push({
      type: "video",
      mimeType: msg.video.mime_type ?? "video/mp4",
      sizeBytes: msg.video.file_size,
      caption: msg.caption,
    });
    fileIds.push(msg.video.file_id);
  }

  if (msg.sticker) {
    media.push({
      type: "sticker",
      mimeType: msg.sticker.is_animated ? "application/x-tgsticker" : "image/webp",
      caption: msg.sticker.emoji ? `Sticker: ${msg.sticker.emoji}` : undefined,
    });
    fileIds.push(msg.sticker.file_id);
  }

  return { media, fileIds };
}

/**
 * Transform a raw Telegram update into a unified MsgContext.
 */
export function telegramUpdateToContext(update: TelegramUpdate): MsgContext {
  const msg = update.message;
  if (!msg) {
    throw new Error("Update has no message field");
  }

  if (!msg.chat || typeof msg.chat.id !== "number") {
    throw new Error("Update has invalid or missing chat.id");
  }

  if (msg.from !== undefined && typeof msg.from.id !== "number") {
    throw new Error("Update has invalid from.id");
  }

  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
  const senderName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Unknown";

  // Extract media attachments
  const { media } = extractTelegramMedia(msg);

  // Use caption as text when text is empty but caption is present
  const text = msg.text ?? msg.caption ?? "";

  return buildMsgContext({
    messageId: String(msg.message_id),
    channel: "telegram",
    text,
    senderId: String(msg.from?.id ?? msg.chat.id),
    senderName,
    accountId: String(msg.chat.id),
    isGroup,
    groupId: isGroup ? String(msg.chat.id) : undefined,
    groupName: isGroup ? msg.chat.title : undefined,
    media: media.length > 0 ? media : undefined,
    raw: update,
  });
}
