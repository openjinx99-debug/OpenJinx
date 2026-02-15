/** A system event queued for delivery to the agent. */
export interface SystemEvent {
  /** Unique event ID. */
  id: string;
  /** Human-readable event text. */
  text: string;
  /** Timestamp of the event. */
  timestamp: number;
  /** Source of the event. */
  source: SystemEventSource;
  /** Session key this event is scoped to. */
  sessionKey: string;
}

export type SystemEventSource =
  | "heartbeat"
  | "cron"
  | "channel"
  | "memory"
  | "system"
  | "user"
  | "composio-trigger";

/** System event queue interface. */
export interface SystemEventQueue {
  /** Enqueue a new event. */
  enqueue(text: string, sessionKey: string, source: SystemEventSource): void;
  /** Peek at events without removing them. */
  peek(sessionKey: string): SystemEvent[];
  /** Drain (consume) all events for a session. */
  drain(sessionKey: string): SystemEvent[];
  /** Current count for a session. */
  count(sessionKey: string): number;
}
