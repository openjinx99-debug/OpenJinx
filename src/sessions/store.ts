import fs from "node:fs/promises";
import path from "node:path";
import type { SessionEntry, SessionStore } from "../types/sessions.js";
import { ensureHomeDir } from "../infra/home-dir.js";
import { createLogger } from "../infra/logger.js";
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from "../infra/security.js";

const logger = createLogger("sessions");

const STORE_FILENAME = "sessions/store.json";

export function createSessionStore(): SessionStore {
  const entries = new Map<string, SessionEntry>();

  const store: SessionStore = {
    get(sessionKey) {
      return entries.get(sessionKey);
    },

    set(sessionKey, entry) {
      entries.set(sessionKey, entry);
    },

    delete(sessionKey) {
      return entries.delete(sessionKey);
    },

    list() {
      return [...entries.values()];
    },

    async save() {
      const homeDir = ensureHomeDir();
      const storePath = path.join(homeDir, STORE_FILENAME);
      await fs.mkdir(path.dirname(storePath), { recursive: true, mode: SECURE_DIR_MODE });
      const data = Object.fromEntries(entries);
      await fs.writeFile(storePath, JSON.stringify(data, null, 2), {
        encoding: "utf-8",
        mode: SECURE_FILE_MODE,
      });
      logger.debug(`Saved ${entries.size} sessions`);
    },

    async load() {
      const homeDir = ensureHomeDir();
      const storePath = path.join(homeDir, STORE_FILENAME);
      try {
        const content = await fs.readFile(storePath, "utf-8");
        const data = JSON.parse(content) as Record<string, SessionEntry>;
        entries.clear();
        for (const [key, entry] of Object.entries(data)) {
          entries.set(key, entry);
        }
        logger.debug(`Loaded ${entries.size} sessions`);
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === "ENOENT") {
          logger.debug("No session store found, starting fresh");
          return;
        }
        throw err;
      }
    },
  };

  return store;
}

/** Create a new session entry with sensible defaults. */
export function createSessionEntry(
  params: Pick<SessionEntry, "sessionKey" | "agentId" | "channel"> & Partial<SessionEntry>,
): SessionEntry {
  const now = Date.now();
  return {
    sessionId: crypto.randomUUID(),
    transcriptPath: "",
    createdAt: now,
    lastActiveAt: now,
    turnCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    contextTokens: 0,
    locked: false,
    ...params,
  };
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
