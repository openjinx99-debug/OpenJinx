import fs from "node:fs/promises";
import { homeRelative } from "../infra/home-dir.js";
import { SECURE_DIR_MODE } from "../infra/security.js";

/** Resolve the root directory for all task outputs (~/.jinx/tasks). */
export function resolveTasksRoot(): string {
  return homeRelative("tasks");
}

/**
 * Resolve a scoped task directory for a specific task type and ID.
 * Returns an absolute path like ~/.jinx/tasks/chat-telegram-dm-12345.
 *
 * The ID is sanitized: colons become dashes, lowercased, non-alphanumeric
 * characters (except dashes and underscores) are stripped.
 */
export function resolveTaskDir(type: "chat" | "deepwork" | "marathon", id: string): string {
  const slug = sanitizeSlug(id);
  return homeRelative(`tasks/${type}-${slug}`);
}

/** Ensure a task directory exists with secure permissions. */
export async function ensureTaskDir(taskDir: string): Promise<void> {
  await fs.mkdir(taskDir, { recursive: true, mode: SECURE_DIR_MODE });
}

/** Sanitize an ID into a safe directory slug. */
function sanitizeSlug(id: string): string {
  return id
    .toLowerCase()
    .replace(/:/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}
