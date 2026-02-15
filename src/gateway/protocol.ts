import { z } from "zod/v4";
import { LIMITS } from "../infra/security.js";

/** Gateway WebSocket message types. */

export type GatewayMessage =
  | ChatSendMessage
  | ChatDeltaMessage
  | ChatFinalMessage
  | ChatAbortedMessage
  | ConfigReloadMessage
  | HealthCheckMessage
  | HealthStatusMessage
  | HeartbeatWakeMessage;

export interface ChatSendMessage {
  type: "chat.send";
  id: string;
  sessionKey: string;
  text: string;
  channel?: string;
}

export interface ChatDeltaMessage {
  type: "chat.delta";
  id: string;
  sessionKey: string;
  text: string;
}

export interface ChatFinalMessage {
  type: "chat.final";
  id: string;
  sessionKey: string;
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatAbortedMessage {
  type: "chat.aborted";
  id: string;
  sessionKey: string;
  reason: string;
}

export interface ConfigReloadMessage {
  type: "config.reload";
}

export interface HealthCheckMessage {
  type: "health.check";
}

export interface HealthStatusMessage {
  type: "health.status";
  ok: boolean;
  uptime: number;
  sessions: number;
}

export interface HeartbeatWakeMessage {
  type: "heartbeat.wake";
  agentId: string;
}

// ── Inbound Message Validation ──────────────────────────────────────────

const chatSendSchema = z.object({
  type: z.literal("chat.send"),
  id: z.string().min(1).max(256),
  sessionKey: z.string().min(1).max(LIMITS.MAX_SESSION_KEY_LENGTH),
  text: z.string().min(1).max(LIMITS.MAX_MESSAGE_TEXT_BYTES),
  channel: z.string().optional(),
});

const healthCheckSchema = z.object({ type: z.literal("health.check") });
const configReloadSchema = z.object({ type: z.literal("config.reload") });
const heartbeatWakeSchema = z.object({
  type: z.literal("heartbeat.wake"),
  agentId: z.string().min(1).max(256),
});

const inboundMessageSchema = z.union([
  chatSendSchema,
  healthCheckSchema,
  configReloadSchema,
  heartbeatWakeSchema,
]);

/** Parse and validate an inbound gateway message. Returns null if invalid. */
export function parseInboundMessage(raw: string): GatewayMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = inboundMessageSchema.safeParse(parsed);
  return result.success ? (result.data as GatewayMessage) : null;
}
