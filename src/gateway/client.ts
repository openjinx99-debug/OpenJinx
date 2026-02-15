import WebSocket from "ws";
import type { GatewayMessage } from "./protocol.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("gateway-client");

/** Reconnection config. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_FACTOR = 1.5;

export interface GatewayClient {
  connect(): Promise<void>;
  disconnect(): void;
  send(msg: GatewayMessage): void;
  onMessage(handler: (msg: GatewayMessage) => void): () => void;
  readonly connected: boolean;
}

export function createGatewayClient(url: string): GatewayClient {
  let ws: WebSocket | undefined;
  let isConnected = false;
  let intentionalClose = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  const handlers: Array<(msg: GatewayMessage) => void> = [];

  function wireSocket(
    socket: WebSocket,
    resolve?: (value: void) => void,
    reject?: (reason: unknown) => void,
  ): void {
    socket.on("open", () => {
      isConnected = true;
      reconnectAttempt = 0;
      logger.info(`Connected to ${url}`);
      resolve?.();
    });

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as GatewayMessage;
        for (const handler of handlers) {
          handler(msg);
        }
      } catch (err) {
        logger.error(`Failed to parse message: ${err}`);
      }
    });

    socket.on("close", () => {
      isConnected = false;
      if (!intentionalClose) {
        logger.info("Disconnected from gateway — will reconnect");
        scheduleReconnect();
      } else {
        logger.info("Disconnected from gateway");
      }
    });

    socket.on("error", (err) => {
      if (!isConnected && reject) {
        reject(err);
      }
      logger.error(`WebSocket error: ${err.message}`);
    });
  }

  function scheduleReconnect(): void {
    if (reconnectTimer || intentionalClose) {
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    reconnectAttempt++;

    logger.info(`Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempt})`);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (intentionalClose) {
        return;
      }

      try {
        ws = new WebSocket(url);
        wireSocket(ws);
      } catch (err) {
        logger.error(`Reconnection failed: ${err}`);
        scheduleReconnect();
      }
    }, delay);
    reconnectTimer.unref();
  }

  return {
    get connected() {
      return isConnected;
    },

    async connect() {
      intentionalClose = false;
      reconnectAttempt = 0;
      return new Promise<void>((resolve, reject) => {
        ws = new WebSocket(url);
        wireSocket(ws, resolve, reject);
      });
    },

    disconnect() {
      intentionalClose = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      if (ws) {
        ws.close();
        ws = undefined;
      }
      isConnected = false;
    },

    send(msg) {
      if (ws && isConnected) {
        ws.send(JSON.stringify(msg));
      }
    },

    onMessage(handler) {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) {
          handlers.splice(idx, 1);
        }
      };
    },
  };
}
