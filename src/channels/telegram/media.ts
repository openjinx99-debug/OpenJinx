import { createLogger } from "../../infra/logger.js";

const logger = createLogger("telegram:media");

/**
 * Download a file from Telegram by file ID.
 */
export async function downloadTelegramMedia(params: {
  fileId: string;
  botToken: string;
}): Promise<Buffer> {
  const { fileId, botToken } = params;

  // Step 1: get file path
  const infoUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
  const infoResp = await fetch(infoUrl);
  if (!infoResp.ok) {
    throw new Error(`getFile failed: ${infoResp.status}`);
  }

  const info = (await infoResp.json()) as { result?: { file_path?: string } };
  const filePath = info.result?.file_path;
  if (!filePath) {
    throw new Error("No file_path in getFile response");
  }

  // Step 2: download
  const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  logger.debug(`Downloading ${downloadUrl}`);
  const dlResp = await fetch(downloadUrl);
  if (!dlResp.ok) {
    throw new Error(`File download failed: ${dlResp.status}`);
  }

  const arrayBuf = await dlResp.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Send a media file to a Telegram chat.
 */
export async function sendTelegramMedia(params: {
  chatId: string | number;
  botToken: string;
  buffer: Buffer;
  type: string;
  filename?: string;
  caption?: string;
}): Promise<void> {
  const { chatId, botToken, buffer, type, filename, caption } = params;
  const method = mediaMethodForType(type);
  const fieldName = mediaFieldForType(type);
  const url = `https://api.telegram.org/bot${botToken}/${method}`;

  logger.debug(
    `Sending ${type} to ${chatId} (${buffer.length} bytes, filename=${filename ?? "?"})`,
  );

  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append(fieldName, new Blob([new Uint8Array(buffer)]), filename ?? `file.${type}`);
  if (caption) {
    form.append("caption", caption);
  }

  const resp = await fetch(url, { method: "POST", body: form });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${method} failed: ${resp.status} ${body}`);
  }
}

function mediaMethodForType(type: string): string {
  switch (type) {
    case "photo":
    case "image":
      return "sendPhoto";
    case "audio":
      return "sendAudio";
    case "video":
      return "sendVideo";
    default:
      return "sendDocument";
  }
}

function mediaFieldForType(type: string): string {
  switch (type) {
    case "photo":
    case "image":
      return "photo";
    case "audio":
      return "audio";
    case "video":
      return "video";
    default:
      return "document";
  }
}
