const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/** In-memory store of recent heartbeat texts per agent. */
const recentTexts = new Map<string, { text: string; timestamp: number }[]>();

/** Persistent duplicate store interface for surviving restarts. */
export interface DuplicateStore {
  getLast(agentId: string): { text: string; timestamp: number } | undefined;
  setLast(agentId: string, text: string, timestamp: number): void;
}

let persistentStore: DuplicateStore | undefined;

/** Wire a persistent store (backed by SessionStore at boot). */
export function setPersistentDuplicateStore(store: DuplicateStore): void {
  persistentStore = store;
}

/**
 * Check if this heartbeat text is a duplicate within the 24h window.
 * Falls back to persistent store when in-memory misses (restart scenario).
 */
export function isDuplicateHeartbeat(agentId: string, text: string, now = Date.now()): boolean {
  const entries = recentTexts.get(agentId) ?? [];

  // Clean old entries
  const recent = entries.filter((e) => now - e.timestamp < DUPLICATE_WINDOW_MS);
  recentTexts.set(agentId, recent);

  if (recent.some((e) => e.text === text)) {
    return true;
  }

  // Fallback: check persistent store (restart scenario — in-memory is empty)
  if (persistentStore && recent.length === 0) {
    const last = persistentStore.getLast(agentId);
    if (last && last.text === text && now - last.timestamp < DUPLICATE_WINDOW_MS) {
      return true;
    }
  }

  return false;
}

/**
 * Record a heartbeat text to the duplicate detection store.
 * Writes to both in-memory and persistent stores.
 */
export function recordHeartbeatText(agentId: string, text: string, now = Date.now()): void {
  const entries = recentTexts.get(agentId) ?? [];
  entries.push({ text, timestamp: now });
  recentTexts.set(agentId, entries);

  // Also persist for restart survival
  persistentStore?.setLast(agentId, text, now);
}

/** Clear duplicate tracking (for testing). */
export function clearDuplicateStore(): void {
  recentTexts.clear();
  persistentStore = undefined;
}
