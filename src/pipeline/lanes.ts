import { createLogger } from "../infra/logger.js";

const logger = createLogger("lanes");

/** Max queued items per lane before rejecting new enqueues. */
const MAX_QUEUE_DEPTH = 10;

/** Idle lanes are evicted after 30 minutes. */
const LANE_TTL_MS = 30 * 60_000;

/** Sweep interval for idle lane eviction. */
const SWEEP_INTERVAL_MS = 60_000;

interface QueueItem {
  id: string;
  fn: () => Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

/**
 * Concurrency lane — processes queued functions with a max concurrency limit.
 */
export class Lane {
  private queue: QueueItem[] = [];
  private active = 0;
  private idCounter = 0;

  /** Timestamp of last enqueue or drain completion. */
  lastUsedAt = Date.now();

  constructor(
    readonly name: string,
    readonly maxConcurrent: number,
  ) {}

  /** Enqueue a function and return a promise that resolves when it completes. */
  enqueue(fn: () => Promise<void>): Promise<void> {
    if (this.queue.length >= MAX_QUEUE_DEPTH) {
      return Promise.reject(
        new Error(`Lane ${this.name}: queue full (${MAX_QUEUE_DEPTH} pending)`),
      );
    }
    this.lastUsedAt = Date.now();
    return new Promise((resolve, reject) => {
      const id = `${this.name}-${++this.idCounter}`;
      this.queue.push({ id, fn, resolve, reject });
      this.drain();
    });
  }

  /** Current queue depth. */
  get pending(): number {
    return this.queue.length;
  }

  /** Currently running count. */
  get running(): number {
    return this.active;
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active++;
      logger.debug(`Lane ${this.name}: starting ${item.id} (active=${this.active})`);

      item
        .fn()
        .then(() => item.resolve())
        .catch((err) => item.reject(err))
        .finally(() => {
          this.active--;
          this.lastUsedAt = Date.now();
          this.drain();
        });
    }
  }
}

/** Per-session lane: max 1 concurrent per session. */
const sessionLanes = new Map<string, Lane>();

let sweepTimer: ReturnType<typeof setInterval> | undefined;

function startLaneSweep(): void {
  if (sweepTimer) {
    return;
  }
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, lane] of sessionLanes) {
      if (lane.running === 0 && lane.pending === 0 && now - lane.lastUsedAt > LANE_TTL_MS) {
        sessionLanes.delete(key);
        logger.debug(`Evicted idle lane: ${key}`);
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref(); // don't prevent process exit
}

export function getSessionLane(sessionKey: string): Lane {
  startLaneSweep();
  let lane = sessionLanes.get(sessionKey);
  if (!lane) {
    lane = new Lane(`session:${sessionKey}`, 1);
    sessionLanes.set(sessionKey, lane);
  }
  lane.lastUsedAt = Date.now();
  return lane;
}

/** Stop the periodic sweep (for clean shutdown). */
export function stopLaneSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }
}

/** Current number of tracked session lanes (for diagnostics). */
export function sessionLaneCount(): number {
  return sessionLanes.size;
}

/** Global lane: max N concurrent across all sessions. */
let globalLane: Lane | undefined;

export function getGlobalLane(maxConcurrent = 4): Lane {
  if (!globalLane) {
    globalLane = new Lane("global", maxConcurrent);
  }
  return globalLane;
}
