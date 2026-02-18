import type { ChannelId } from "./config.js";

/** Target for delivering marathon progress and results. */
export interface DeliveryTarget {
  channel: ChannelId;
  to: string;
  accountId?: string;
}

/** Metadata about a user-provided input file seeded into the marathon workspace. */
export interface InputFileInfo {
  name: string;
  sizeBytes: number;
  mimeType: string;
}

/** Snapshot of control authorization for a marathon task. */
export interface MarathonControlPolicy {
  /** Task owner when available (usually the starter's sender ID). */
  ownerSenderId?: string;
  /** Origin group ID when task started in a group session. */
  originGroupId?: string;
  /** Explicit controllers allowed to operate this task. */
  allowedSenderIds: string[];
  /** Whether any member in originGroupId may control this task. */
  allowSameGroupMembers: boolean;
}

/** Marathon task checkpoint — persisted to disk after each state change. */
export interface MarathonCheckpoint {
  taskId: string;
  sessionKey: string;
  containerId: string;
  /** Cron job ID for the watchdog, if registered. */
  watchdogJobId?: string;
  status: MarathonStatus;
  plan: ChunkPlan;
  currentChunkIndex: number;
  completedChunks: ChunkResult[];
  createdAt: number;
  updatedAt: number;
  deliverTo: DeliveryTarget;
  workspaceDir: string;
  /** Session key that initiated this marathon (for authorization checks). */
  originSessionKey: string;
  /** Sender ID that initiated this marathon (group authorization hardening). */
  originSenderId?: string;
  /** Snapshot authorization policy used by /marathon controls. */
  controlPolicy?: MarathonControlPolicy;
  maxRetriesPerChunk: number;
  /** Input files seeded from user media attachments. */
  inputFiles?: InputFileInfo[];
}

export type MarathonStatus =
  | "planning"
  | "executing"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** The overall plan decomposed from the user's request. */
export interface ChunkPlan {
  /** High-level goal description. */
  goal: string;
  /** Ordered list of work chunks. */
  chunks: ChunkDefinition[];
}

/** A single unit of work in the marathon plan. */
export interface ChunkDefinition {
  name: string;
  prompt: string;
  estimatedMinutes: number;
  /** Testable conditions that define when the chunk is done (verified programmatically). */
  acceptanceCriteria: string[];
}

/** Result of verifying a single acceptance criterion. */
export interface CriterionResult {
  criterion: string;
  passed: boolean;
  detail?: string;
}

/** Result of verifying all acceptance criteria for a chunk. */
export interface CriteriaVerificationResult {
  allPassed: boolean;
  results: CriterionResult[];
  passCount: number;
  failCount: number;
}

/** Result from the test-fix loop after a chunk completes. */
export interface TestFixResult {
  testsPassed: boolean;
  fixIterations: number;
  finalTestOutput?: string;
  testCommand?: string;
}

/** Result of executing a single chunk. */
export interface ChunkResult {
  chunkName: string;
  status: "completed" | "failed" | "skipped";
  summary: string;
  filesWritten: string[];
  durationMs: number;
  completedAt: number;
  /** Per-chunk retry counter (resets on advance). */
  failedAttempts: number;
  /** Error message if failed. */
  lastError?: string;
  /** Test-fix loop result, if tests were detected and run. */
  testStatus?: TestFixResult;
  /** Acceptance criteria verification result. */
  criteriaResult?: CriteriaVerificationResult;
}
