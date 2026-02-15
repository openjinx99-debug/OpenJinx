/**
 * In-memory session write locks.
 * Prevents concurrent agent turns on the same session.
 */

const locks = new Map<string, { acquiredAt: number; resolve: () => void }>();

/** Maximum lock hold time before auto-release (5 minutes). */
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Acquire a write lock for a session. Returns a release function.
 * Throws if the session is already locked.
 */
export function acquireSessionLock(sessionKey: string): () => void {
  cleanExpiredLocks();

  if (locks.has(sessionKey)) {
    throw new Error(`Session ${sessionKey} is already locked`);
  }

  let releaseFn: () => void;
  const promise = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  void promise; // prevent unhandled rejection

  locks.set(sessionKey, { acquiredAt: Date.now(), resolve: releaseFn! });

  return () => {
    const lock = locks.get(sessionKey);
    if (lock) {
      lock.resolve();
      locks.delete(sessionKey);
    }
  };
}

/**
 * Try to acquire a lock, returning undefined if already locked.
 */
export function tryAcquireSessionLock(sessionKey: string): (() => void) | undefined {
  try {
    return acquireSessionLock(sessionKey);
  } catch {
    return undefined;
  }
}

/**
 * Check if a session is currently locked.
 */
export function isSessionLocked(sessionKey: string): boolean {
  cleanExpiredLocks();
  return locks.has(sessionKey);
}

/**
 * Wait for a session lock to be released, then acquire it.
 */
export async function waitForSessionLock(
  sessionKey: string,
  timeoutMs = 30_000,
): Promise<() => void> {
  const deadline = Date.now() + timeoutMs;

  while (isSessionLocked(sessionKey)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for session lock: ${sessionKey}`);
    }
    await sleep(100);
  }

  return acquireSessionLock(sessionKey);
}

function cleanExpiredLocks(): void {
  const now = Date.now();
  for (const [key, lock] of locks) {
    if (now - lock.acquiredAt > LOCK_TIMEOUT_MS) {
      lock.resolve();
      locks.delete(key);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
