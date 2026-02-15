import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { JinxConfig } from "../types/config.js";
import type { GatewayMessage, ChatSendMessage } from "./protocol.js";
import { requestHeartbeatNow } from "../heartbeat/wake.js";
import { createLogger } from "../infra/logger.js";
import { LIMITS, sanitizeErrorForClient } from "../infra/security.js";
import { buildMsgContext } from "../pipeline/context.js";
import { dispatchInboundMessage, type DispatchDeps } from "../pipeline/dispatch.js";
import { subscribeStream } from "../pipeline/streaming.js";
import { parseInboundMessage } from "./protocol.js";

const logger = createLogger("gateway");

// ── Connection rate limiting ────────────────────────────────────────────

const RATE_WINDOW_MS = 10_000;
const MAX_CONNECTIONS_PER_WINDOW = 20;
const connectionTimestamps: number[] = [];

function isConnectionRateLimited(): boolean {
  const now = Date.now();
  // Remove timestamps outside the sliding window
  while (connectionTimestamps.length > 0 && connectionTimestamps[0] < now - RATE_WINDOW_MS) {
    connectionTimestamps.shift();
  }
  if (connectionTimestamps.length >= MAX_CONNECTIONS_PER_WINDOW) {
    return true;
  }
  connectionTimestamps.push(now);
  return false;
}

export interface GatewayServer {
  start(): void;
  stop(): Promise<void>;
}

export function createGatewayServer(config: JinxConfig, deps: DispatchDeps): GatewayServer {
  let wss: WebSocketServer | undefined;
  const startedAt = Date.now();

  return {
    start() {
      wss = new WebSocketServer({
        host: config.gateway.host,
        port: config.gateway.port,
        maxPayload: config.gateway.maxPayloadBytes ?? LIMITS.MAX_GATEWAY_PAYLOAD_BYTES,
        verifyClient(
          info: { origin: string; req: IncomingMessage; secure: boolean },
          cb: (res: boolean, code?: number, message?: string) => void,
        ) {
          // Rate limiting
          if (isConnectionRateLimited()) {
            cb(false, 429, "Too many connections");
            return;
          }

          // Auth token check (header only — never accept tokens in URL query params)
          if (config.gateway.authToken) {
            const authHeader = info.req.headers.authorization;
            const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

            if (bearerToken !== config.gateway.authToken) {
              cb(false, 401, "Unauthorized");
              return;
            }
          }

          // Origin check
          if (config.gateway.allowedOrigins && config.gateway.allowedOrigins.length > 0) {
            if (!config.gateway.allowedOrigins.includes(info.origin)) {
              cb(false, 403, "Origin not allowed");
              return;
            }
          }

          cb(true);
        },
      });

      wss.on("connection", (ws) => {
        logger.info("Client connected");

        ws.on("message", (data) => {
          const msg = parseInboundMessage(data.toString());
          if (!msg) {
            logger.error("Failed to parse or validate inbound message");
            return;
          }
          handleMessage(ws, msg, deps, startedAt);
        });

        ws.on("close", () => {
          logger.info("Client disconnected");
        });
      });

      logger.info(`Gateway server listening on ws://${config.gateway.host}:${config.gateway.port}`);
    },

    async stop() {
      if (wss) {
        for (const client of wss.clients) {
          client.close();
        }
        await new Promise<void>((resolve) => wss!.close(() => resolve()));
        logger.info("Gateway server stopped");
      }
    },
  };
}

function handleMessage(
  ws: WebSocket,
  msg: GatewayMessage,
  deps: DispatchDeps,
  startedAt: number,
): void {
  switch (msg.type) {
    case "chat.send":
      handleChatSend(ws, msg, deps);
      break;
    case "health.check":
      ws.send(
        JSON.stringify({
          type: "health.status",
          ok: true,
          uptime: Date.now() - startedAt,
          sessions: deps.sessions.list().length,
        }),
      );
      break;
    case "config.reload":
      logger.info("Config reload requested");
      break;
    case "heartbeat.wake":
      requestHeartbeatNow(msg.agentId, "manual");
      ws.send(JSON.stringify({ type: "heartbeat.wake.ack", agentId: msg.agentId }));
      break;
  }
}

async function handleChatSend(
  ws: WebSocket,
  msg: ChatSendMessage,
  deps: DispatchDeps,
): Promise<void> {
  const ctx = buildMsgContext({
    messageId: msg.id,
    channel: "terminal",
    text: msg.text,
    senderId: "local",
    senderName: "User",
    accountId: "local",
    isGroup: false,
  });

  // Subscribe to stream events and map to gateway protocol types
  const unsub = subscribeStream(ctx.sessionKey, (event) => {
    const gatewayType =
      event.type === "delta"
        ? "chat.delta"
        : event.type === "final"
          ? "chat.final"
          : event.type === "aborted"
            ? "chat.aborted"
            : event.type;
    ws.send(
      JSON.stringify({ ...event, type: gatewayType, id: msg.id, sessionKey: ctx.sessionKey }),
    );
  });

  try {
    await dispatchInboundMessage(ctx, deps);
  } catch (err) {
    ws.send(
      JSON.stringify({
        type: "chat.aborted",
        id: msg.id,
        sessionKey: ctx.sessionKey,
        reason: sanitizeErrorForClient(err),
      }),
    );
  } finally {
    unsub();
  }
}
