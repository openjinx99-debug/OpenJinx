import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { TranscriptTurn } from "../types/sessions.js";
import { ensureHomeDir } from "../infra/home-dir.js";
import { createLogger } from "../infra/logger.js";
import { LIMITS, SECURE_DIR_MODE, SECURE_FILE_MODE } from "../infra/security.js";

const logger = createLogger("transcript");

/**
 * Resolve the transcript file path for a session.
 */
export function resolveTranscriptPath(sessionKey: string): string {
  const homeDir = ensureHomeDir();
  const safeName = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(homeDir, "sessions", `${safeName}.jsonl`);
}

/**
 * Append a turn to the session transcript (JSONL format).
 * Uses file handle with mode to set permissions atomically on creation.
 */
export async function appendTranscriptTurn(
  transcriptPath: string,
  turn: TranscriptTurn,
): Promise<void> {
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true, mode: SECURE_DIR_MODE });
  const line = JSON.stringify(turn) + "\n";
  const fh = await fs.open(transcriptPath, "a", SECURE_FILE_MODE);
  try {
    await fh.appendFile(line, "utf-8");
  } finally {
    await fh.close();
  }
}

/**
 * Atomically rewrite an entire transcript file with new turns.
 * Writes to a random temp file first, then renames over the original.
 */
export async function rewriteTranscript(
  transcriptPath: string,
  turns: TranscriptTurn[],
): Promise<void> {
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true, mode: SECURE_DIR_MODE });
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  const tmpPath = `${transcriptPath}.${randomSuffix}.tmp`;
  const content = turns.map((t) => JSON.stringify(t)).join("\n") + "\n";
  try {
    await fs.writeFile(tmpPath, content, { mode: SECURE_FILE_MODE });
    await fs.rename(tmpPath, transcriptPath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      await fs.unlink(tmpPath);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Read all turns from a session transcript.
 */
export async function readTranscript(transcriptPath: string): Promise<TranscriptTurn[]> {
  let content: string;
  try {
    const stat = await fs.stat(transcriptPath);
    if (stat.size > LIMITS.MAX_TRANSCRIPT_FILE_BYTES) {
      logger.warn(
        `Transcript ${transcriptPath} is ${stat.size} bytes, exceeds limit of ${LIMITS.MAX_TRANSCRIPT_FILE_BYTES} — returning empty`,
      );
      return [];
    }
    content = await fs.readFile(transcriptPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logger.warn(`Failed to read transcript ${transcriptPath}: ${code ?? err}`);
    }
    return [];
  }

  const turns: TranscriptTurn[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      turns.push(JSON.parse(trimmed) as TranscriptTurn);
    } catch {
      // Skip malformed lines
    }
  }
  return turns;
}

/**
 * Read the last N turns from a transcript.
 */
export async function readRecentTurns(
  transcriptPath: string,
  count: number,
): Promise<TranscriptTurn[]> {
  const all = await readTranscript(transcriptPath);
  return all.slice(-count);
}

/**
 * Count turns in a transcript without loading all content into memory.
 */
export async function countTurns(transcriptPath: string): Promise<number> {
  try {
    const content = await fs.readFile(transcriptPath, "utf-8");
    return content.split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}
