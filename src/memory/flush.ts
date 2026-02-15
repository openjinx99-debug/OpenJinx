import { MEMORY_FLUSH_PROMPT } from "../heartbeat/prompts.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("memory");

/**
 * Pre-compaction memory flush.
 * Triggers a silent agent turn to persist important memories before compacting.
 */
export async function flushMemoryBeforeCompaction(params: {
  sessionKey: string;
  contextSummary: string;
  runTurn?: (prompt: string) => Promise<string>;
}): Promise<void> {
  logger.info(
    `Memory flush triggered for session ${params.sessionKey} (summary: ${params.contextSummary.length} chars)`,
  );

  if (!params.runTurn) {
    logger.debug("No runTurn callback provided — skipping flush");
    return;
  }

  await params.runTurn(MEMORY_FLUSH_PROMPT);
}
