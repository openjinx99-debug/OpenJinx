import { DisconnectReason, makeWASocket, useMultiFileAuthState } from "baileys";
import { expandTilde } from "../../infra/home-dir.js";
import { createLogger } from "../../infra/logger.js";
import { renderQrToTerminal } from "./render-qr.js";

const logger = createLogger("whatsapp:qr");

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_AUTH_DIR = "~/.jinx/whatsapp-auth";

export interface QrLoginOptions {
  timeout?: number;
  authDir?: string;
  onQr?: (qr: string) => void;
}

/**
 * Start the WhatsApp QR code login flow.
 * Returns true if authentication succeeded within the timeout.
 */
export async function startQrLogin(params?: QrLoginOptions): Promise<boolean> {
  const timeout = params?.timeout ?? DEFAULT_TIMEOUT_MS;
  const authDir = expandTilde(params?.authDir ?? DEFAULT_AUTH_DIR);
  const onQr = params?.onQr;

  logger.info(`Starting QR login (authDir=${authDir}, timeout=${timeout}ms)`);

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
  });

  // Persist credentials on update
  sock.ev.on("creds.update", saveCreds);

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        logger.warn("QR login timed out");
        sock.end(undefined);
        resolve(false);
      }
    }, timeout);

    sock.ev.on("connection.update", (update: Record<string, unknown>) => {
      const { connection, qr, lastDisconnect } = update as {
        connection?: string;
        qr?: string;
        lastDisconnect?: { error?: { output?: { statusCode?: number } } };
      };

      if (qr) {
        // Render QR to terminal unless caller handles it
        if (onQr) {
          onQr(qr);
        } else {
          const rendered = renderQrToTerminal(qr);
          logger.info("Scan this QR code with WhatsApp:\n" + rendered);
        }
      }

      if (connection === "open" && !settled) {
        settled = true;
        clearTimeout(timer);
        logger.info("QR login successful");
        sock.end(undefined);
        resolve(true);
      }

      if (connection === "close" && !settled) {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        // Don't resolve on close if it's a restart request — Baileys may reconnect
        if (statusCode !== DisconnectReason.restartRequired) {
          settled = true;
          clearTimeout(timer);
          logger.info(`QR login closed (status=${statusCode})`);
          resolve(false);
        }
      }
    });
  });
}
