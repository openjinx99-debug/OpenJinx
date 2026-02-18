import { Browsers, DisconnectReason, makeWASocket, useMultiFileAuthState } from "baileys";
import type { WhatsAppMessage } from "./context.js";
import { createLogger } from "../../infra/logger.js";
import { BAILEYS_SILENT_LOGGER } from "./baileys-logger.js";
import { renderQrToTerminal } from "./render-qr.js";

const logger = createLogger("whatsapp:session");

const RECONNECT_INITIAL_DELAY_MS = 3000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const DISCONNECT_LOG_SUMMARY_INTERVAL_MS = 60_000;

/** Minimal interface for a WhatsApp socket (Baileys-compatible shape). */
export interface WhatsAppSocket {
  sendMessage(jid: string, content: Record<string, unknown>): Promise<void>;
  sendPresenceUpdate(presence: "composing" | "available" | "paused", jid: string): Promise<void>;
  end(): void;
  readonly isConnected: boolean;
}

export interface WhatsAppSessionEvents {
  onMessage: (msg: WhatsAppMessage) => void | Promise<void>;
  onConnectionUpdate: (update: { connection?: string; qr?: string; isLoggedOut?: boolean }) => void;
}

export interface CreateSessionResult {
  socket: WhatsAppSocket;
  cleanup: () => void;
}

/**
 * Create a WhatsApp session using Baileys.
 * Connects to WhatsApp via multi-device protocol and wires event listeners.
 * Automatically reconnects on non-logout disconnections (e.g. 515 restart required).
 *
 * The returned promise resolves once Baileys has initialized the socket
 * and wired all event listeners. Connection happens asynchronously —
 * check `socket.isConnected` or listen to `onConnectionUpdate` for status.
 */
export async function createWhatsAppSession(
  authDir: string,
  events: WhatsAppSessionEvents,
  browserName?: string,
): Promise<CreateSessionResult> {
  let connected = false;
  let stopped = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentSock: any;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS;
  let disconnectStreak = 0;
  let disconnectStartedAt = 0;
  let lastDisconnectLogAt = 0;
  let suppressedDisconnectLogs = 0;
  let lastDisconnectStatus: number | undefined;

  async function connectSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu(browserName ?? "Jinx"),
      // Keep Baileys internals quiet; we emit curated channel logs ourselves.
      logger: BAILEYS_SILENT_LOGGER as never,
    });

    currentSock = sock;

    // Persist credentials on update — critical for reconnect
    sock.ev.on("creds.update", saveCreds);

    // Track connection state and forward events
    sock.ev.on("connection.update", (update: Record<string, unknown>) => {
      const { connection, qr, lastDisconnect } = update as {
        connection?: string;
        qr?: string;
        lastDisconnect?: { error?: { output?: { statusCode?: number } } };
      };

      if (connection === "open") {
        connected = true;
        if (disconnectStreak > 0) {
          const durationMs = Date.now() - disconnectStartedAt;
          const summary =
            suppressedDisconnectLogs > 0
              ? ` (suppressed ${suppressedDisconnectLogs} repeated disconnect logs)`
              : "";
          logger.info(
            `WhatsApp reconnected after ${disconnectStreak} disconnect(s) over ${Math.round(durationMs / 1000)}s${summary}`,
          );
        }
        disconnectStreak = 0;
        disconnectStartedAt = 0;
        lastDisconnectLogAt = 0;
        suppressedDisconnectLogs = 0;
        lastDisconnectStatus = undefined;
        reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS;
        logger.info("WhatsApp connected");
      }

      if (connection === "close") {
        connected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const now = Date.now();
        disconnectStreak++;
        if (disconnectStartedAt === 0) {
          disconnectStartedAt = now;
        }

        const statusChanged = statusCode !== lastDisconnectStatus;
        const shouldLogDisconnect =
          isLoggedOut ||
          disconnectStreak === 1 ||
          statusChanged ||
          now - lastDisconnectLogAt >= DISCONNECT_LOG_SUMMARY_INTERVAL_MS;
        if (shouldLogDisconnect) {
          const summary =
            suppressedDisconnectLogs > 0
              ? ` (suppressed ${suppressedDisconnectLogs} repeated disconnect logs)`
              : "";
          logger.warn(
            `WhatsApp disconnected (status=${statusCode}, loggedOut=${isLoggedOut}, attempt=${disconnectStreak}, nextRetryMs=${reconnectDelayMs})${summary}`,
          );
          lastDisconnectLogAt = now;
          suppressedDisconnectLogs = 0;
        } else {
          suppressedDisconnectLogs++;
        }
        lastDisconnectStatus = statusCode;
        events.onConnectionUpdate({ connection, isLoggedOut });

        // Auto-reconnect unless logged out or explicitly stopped
        if (!isLoggedOut && !stopped) {
          const scheduledDelayMs = reconnectDelayMs;
          reconnectTimer = setTimeout(() => {
            connectSocket().catch((err) => logger.error("Reconnect failed", err));
          }, scheduledDelayMs);
          reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_DELAY_MS);
        }
        return;
      }

      // Render QR code to terminal when received
      if (qr) {
        const rendered = renderQrToTerminal(qr as string);
        logger.info("Scan this QR code with WhatsApp:\n" + rendered);
      }

      events.onConnectionUpdate({
        connection,
        qr: qr as string | undefined,
      });
    });

    // Forward incoming messages
    sock.ev.on("messages.upsert", (upsert) => {
      // Skip history sync messages
      if (upsert.type !== "notify") {
        return;
      }

      // Get own JID to detect "Message Yourself" chat
      const ownJid = state.creds.me?.id;
      const ownNumber = ownJid?.split(":")[0] ?? ownJid?.split("@")[0];

      for (const raw of upsert.messages) {
        // Skip messages without a JID (shouldn't happen in practice)
        if (!raw.key.remoteJid) {
          continue;
        }

        // Skip our own outgoing messages — but allow "Message Yourself" (self-chat)
        if (raw.key.fromMe) {
          const remoteNumber = raw.key.remoteJid.split("@")[0];
          const isSelfChat = ownNumber && remoteNumber === ownNumber;
          if (!isSelfChat) {
            continue;
          }
        }

        // Cast to our narrower WhatsAppMessage type (remoteJid guaranteed non-null above)
        const msg = raw as unknown as WhatsAppMessage;
        events.onMessage(msg);
      }
    });
  }

  // Initial connection
  await connectSocket();

  const socket: WhatsAppSocket = {
    async sendMessage(jid: string, content: Record<string, unknown>) {
      await currentSock.sendMessage(jid, content);
    },

    async sendPresenceUpdate(presence: "composing" | "available" | "paused", jid: string) {
      await currentSock.sendPresenceUpdate(presence, jid);
    },

    end() {
      stopped = true;
      connected = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      currentSock.end(undefined);
      logger.info("WhatsApp session ended");
    },

    get isConnected() {
      return connected;
    },
  };

  return {
    socket,
    cleanup() {
      socket.end();
    },
  };
}
