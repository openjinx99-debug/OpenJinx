import type { ChannelId } from "./config.js";

/** Why a heartbeat fired — determines which prompt the LLM receives. */
export type HeartbeatReason =
  | "scheduled"
  | "cron-event"
  | "exec-event"
  | "composio-trigger"
  | "manual";

/** Per-agent heartbeat state. */
export interface HeartbeatAgentState {
  agentId: string;
  enabled: boolean;
  intervalMs: number;
  lastRunMs: number;
  nextDueMs: number;
  /** Whether the heartbeat is currently executing. */
  running: boolean;
  /** Number of consecutive empty beats. */
  consecutiveEmpty: number;
  /** Active hours config for this agent (if any). */
  activeHours?: { start: number; end: number; timezone: string };
}

/** Heartbeat event emitted after a heartbeat cycle. */
export interface HeartbeatEvent {
  type: "heartbeat";
  agentId: string;
  timestamp: number;
  /** Whether the beat produced content to deliver. */
  hasContent: boolean;
  /** The text content from the heartbeat (if any). */
  text?: string;
  /** Where to deliver the heartbeat result. */
  deliveryTargets?: HeartbeatDeliveryTarget[];
  /** Whether the HEARTBEAT_OK token was detected. */
  wasOk: boolean;
  /** Duration of the heartbeat agent turn in ms. */
  durationMs: number;
}

export interface HeartbeatDeliveryTarget {
  channel: ChannelId;
  to: string;
  accountId?: string;
}

/** Heartbeat visibility configuration. */
export interface HeartbeatVisibility {
  showOk: boolean;
  showAlerts: boolean;
  useIndicator: boolean;
}
