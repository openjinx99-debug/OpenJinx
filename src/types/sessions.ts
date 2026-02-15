import type { ChannelId } from "./config.js";

/** Persisted session metadata entry. */
export interface SessionEntry {
  sessionId: string;
  sessionKey: string;
  agentId: string;
  channel: ChannelId;
  /** Timestamp of session creation. */
  createdAt: number;
  /** Timestamp of last activity. */
  lastActiveAt: number;
  /** Number of turns in the session. */
  turnCount: number;
  /** Path to the JSONL transcript file. */
  transcriptPath: string;
  /** Sender / peer identifier. */
  peerId?: string;
  /** Peer display name. */
  peerName?: string;
  /** Group ID for group sessions. */
  groupId?: string;
  /** Group name. */
  groupName?: string;
  /** Current model override. */
  modelOverride?: string;
  /** Token usage totals. */
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Context window token count (how full we are). */
  contextTokens: number;
  /** Whether the session is currently locked for processing. */
  locked: boolean;
  /** Heartbeat-specific fields. */
  lastHeartbeatText?: string;
  lastHeartbeatSentAt?: number;
  /** If this is a subagent session, the parent session key that spawned it. */
  parentSessionKey?: string;
}

/** Transcript turn entry (one line of JSONL). */
export interface TranscriptTurn {
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: number;
  /** Tool calls made during this turn. */
  toolCalls?: TranscriptToolCall[];
  /** Token usage for this turn. */
  usage?: { inputTokens: number; outputTokens: number };
  /** Whether this was a compaction summary. */
  isCompaction?: boolean;
}

export interface TranscriptToolCall {
  toolName: string;
  input: unknown;
  output: unknown;
}

/** Session store interface. */
export interface SessionStore {
  get(sessionKey: string): SessionEntry | undefined;
  set(sessionKey: string, entry: SessionEntry): void;
  delete(sessionKey: string): boolean;
  list(): SessionEntry[];
  save(): Promise<void>;
  load(): Promise<void>;
}
