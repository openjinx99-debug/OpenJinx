import fs from "node:fs/promises";
import path from "node:path";
import type {
  ChunkPlan,
  ChunkResult,
  DeliveryTarget,
  InputFileInfo,
  MarathonControlPolicy,
  MarathonCheckpoint,
  MarathonStatus,
} from "../types/marathon.js";
import { homeRelative } from "../infra/home-dir.js";
import { SECURE_DIR_MODE } from "../infra/security.js";

/** Resolve the marathon directory path. */
export function resolveMarathonDir(): string {
  return homeRelative("marathon");
}

/** Resolve the marathon workspace directory path for a given short ID. */
export function resolveMarathonWorkspace(shortId: string): string {
  return homeRelative(`tasks/marathon-${shortId}`);
}

function checkpointPath(taskId: string): string {
  return path.join(resolveMarathonDir(), `${taskId}.json`);
}

async function ensureMarathonDir(): Promise<void> {
  await fs.mkdir(resolveMarathonDir(), { recursive: true, mode: SECURE_DIR_MODE });
}

export interface CreateCheckpointParams {
  taskId: string;
  sessionKey: string;
  containerId: string;
  plan: ChunkPlan;
  deliverTo: DeliveryTarget;
  workspaceDir: string;
  originSessionKey: string;
  originSenderId?: string;
  controlPolicy?: MarathonControlPolicy;
  maxRetriesPerChunk: number;
  inputFiles?: InputFileInfo[];
}

/** Create a new marathon checkpoint in "planning" status. */
export async function createCheckpoint(
  params: CreateCheckpointParams,
): Promise<MarathonCheckpoint> {
  await ensureMarathonDir();

  const now = Date.now();
  const checkpoint: MarathonCheckpoint = {
    taskId: params.taskId,
    sessionKey: params.sessionKey,
    containerId: params.containerId,
    status: "planning",
    plan: params.plan,
    currentChunkIndex: 0,
    completedChunks: [],
    createdAt: now,
    updatedAt: now,
    deliverTo: params.deliverTo,
    workspaceDir: params.workspaceDir,
    originSessionKey: params.originSessionKey,
    originSenderId: params.originSenderId,
    controlPolicy: params.controlPolicy,
    maxRetriesPerChunk: params.maxRetriesPerChunk,
    inputFiles: params.inputFiles,
  };

  await fs.writeFile(checkpointPath(params.taskId), JSON.stringify(checkpoint, null, 2));
  return checkpoint;
}

/** Read a checkpoint from disk. Returns undefined if not found. */
export async function readCheckpoint(taskId: string): Promise<MarathonCheckpoint | undefined> {
  try {
    const data = await fs.readFile(checkpointPath(taskId), "utf-8");
    return JSON.parse(data) as MarathonCheckpoint;
  } catch {
    return undefined;
  }
}

async function writeCheckpoint(checkpoint: MarathonCheckpoint): Promise<void> {
  checkpoint.updatedAt = Date.now();
  await fs.writeFile(checkpointPath(checkpoint.taskId), JSON.stringify(checkpoint, null, 2));
}

export type CheckpointPatch = Partial<Omit<MarathonCheckpoint, "taskId" | "createdAt">>;

/** Terminal statuses that cannot be advanced or modified. */
const TERMINAL_STATUSES = new Set<MarathonStatus>(["completed", "cancelled"]);

/**
 * Advance the checkpoint to the next chunk after a successful completion.
 * If this was the final chunk, sets status to "completed".
 */
export async function advanceCheckpoint(
  taskId: string,
  result: ChunkResult,
): Promise<MarathonCheckpoint> {
  const checkpoint = await readCheckpoint(taskId);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${taskId}`);
  }
  if (TERMINAL_STATUSES.has(checkpoint.status)) {
    throw new Error(`Cannot advance ${checkpoint.status} checkpoint: ${taskId}`);
  }

  checkpoint.completedChunks.push(result);
  checkpoint.currentChunkIndex++;

  if (checkpoint.currentChunkIndex >= checkpoint.plan.chunks.length) {
    checkpoint.status = "completed";
  }

  await writeCheckpoint(checkpoint);
  return checkpoint;
}

/**
 * Record a chunk failure. Increments the per-chunk failedAttempts.
 * If max retries exceeded, pauses the marathon.
 */
export async function failChunk(taskId: string, error: string): Promise<MarathonCheckpoint> {
  const checkpoint = await readCheckpoint(taskId);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${taskId}`);
  }

  // Find or create a result for the current chunk
  const chunkName = checkpoint.plan.chunks[checkpoint.currentChunkIndex]?.name ?? "unknown";
  const existingResult = checkpoint.completedChunks.find(
    (r) => r.chunkName === chunkName && r.status === "failed",
  );

  if (existingResult) {
    existingResult.failedAttempts++;
    existingResult.lastError = error;
  } else {
    checkpoint.completedChunks.push({
      chunkName,
      status: "failed",
      summary: "",
      filesWritten: [],
      durationMs: 0,
      completedAt: Date.now(),
      failedAttempts: 1,
      lastError: error,
    });
  }

  const failedAttempts =
    existingResult?.failedAttempts ??
    checkpoint.completedChunks.filter((r) => r.chunkName === chunkName && r.status === "failed")
      .length;

  if (failedAttempts >= checkpoint.maxRetriesPerChunk) {
    checkpoint.status = "paused";
  }

  await writeCheckpoint(checkpoint);
  return checkpoint;
}

/** Cancel a marathon checkpoint. */
export async function cancelCheckpoint(taskId: string): Promise<void> {
  const checkpoint = await readCheckpoint(taskId);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${taskId}`);
  }
  checkpoint.status = "cancelled";
  await writeCheckpoint(checkpoint);
}

/** Pause a marathon checkpoint. */
export async function pauseCheckpoint(taskId: string): Promise<void> {
  const checkpoint = await readCheckpoint(taskId);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${taskId}`);
  }
  checkpoint.status = "paused";
  await writeCheckpoint(checkpoint);
}

/** Update mutable checkpoint fields in one atomic write. */
export async function patchCheckpoint(
  taskId: string,
  patch: CheckpointPatch,
): Promise<MarathonCheckpoint> {
  const checkpoint = await readCheckpoint(taskId);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${taskId}`);
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    (checkpoint as unknown as Record<string, unknown>)[key] = value;
  }

  await writeCheckpoint(checkpoint);
  return checkpoint;
}

/** Update the checkpoint status directly. */
export async function updateCheckpointStatus(
  taskId: string,
  status: MarathonStatus,
): Promise<void> {
  await patchCheckpoint(taskId, { status });
}

/**
 * Reset the failedAttempts counter for the current chunk.
 * Called on resume so the chunk gets a fresh retry budget.
 */
export async function resetCurrentChunkRetries(taskId: string): Promise<void> {
  const checkpoint = await readCheckpoint(taskId);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${taskId}`);
  }
  const currentChunkName = checkpoint.plan.chunks[checkpoint.currentChunkIndex]?.name;
  if (currentChunkName) {
    const failedEntry = checkpoint.completedChunks.find(
      (r) => r.chunkName === currentChunkName && r.status === "failed",
    );
    if (failedEntry) {
      failedEntry.failedAttempts = 0;
    }
  }
  await writeCheckpoint(checkpoint);
}

/** List checkpoints, optionally filtered by status. */
export async function listCheckpoints(filter?: {
  status?: MarathonStatus[];
}): Promise<MarathonCheckpoint[]> {
  const dir = resolveMarathonDir();
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const checkpoints: MarathonCheckpoint[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    try {
      const data = await fs.readFile(path.join(dir, file), "utf-8");
      const cp = JSON.parse(data) as MarathonCheckpoint;
      if (filter?.status && !filter.status.includes(cp.status)) {
        continue;
      }
      checkpoints.push(cp);
    } catch {
      // Skip corrupt files
    }
  }
  return checkpoints;
}
