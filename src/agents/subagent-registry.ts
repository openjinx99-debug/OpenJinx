import { createLogger } from "../infra/logger.js";

const logger = createLogger("subagent");

export interface SubagentEntry {
  subagentSessionKey: string;
  parentSessionKey: string;
  task: string;
  status: "running" | "completed" | "failed";
  createdAt: number;
  completedAt?: number;
  resultText?: string;
}

const registry = new Map<string, SubagentEntry>();

export function registerSubagent(entry: SubagentEntry): void {
  registry.set(entry.subagentSessionKey, entry);
  logger.info(
    `Registered subagent: ${entry.subagentSessionKey} (parent: ${entry.parentSessionKey})`,
  );
}

export function getSubagent(subagentSessionKey: string): SubagentEntry | undefined {
  return registry.get(subagentSessionKey);
}

export function completeSubagent(
  subagentSessionKey: string,
  resultText: string,
  status: "completed" | "failed" = "completed",
): void {
  const entry = registry.get(subagentSessionKey);
  if (entry) {
    entry.status = status;
    entry.completedAt = Date.now();
    entry.resultText = resultText;
    logger.info(`Subagent ${status}: ${subagentSessionKey}`);
  }
}

export function removeSubagent(subagentSessionKey: string): boolean {
  return registry.delete(subagentSessionKey);
}

export function listSubagentsForParent(parentSessionKey: string): SubagentEntry[] {
  return [...registry.values()].filter((e) => e.parentSessionKey === parentSessionKey);
}

/** Exposed for testing — clears the registry. */
export function clearSubagentRegistry(): void {
  registry.clear();
}
