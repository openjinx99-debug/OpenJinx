import fs from "node:fs/promises";
import type { SessionStore } from "../types/sessions.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("reaper");

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface ReaperConfig {
  /** Session key prefixes to match for reaping (e.g., ["cron:"]). */
  prefixes: string[];
  /** Max age in ms before a matching session is reaped. Default 24h. */
  maxAgeMs?: number;
  /** How often to sweep in ms. Default 1h. */
  intervalMs?: number;
}

export class SessionReaper {
  private timer?: ReturnType<typeof setInterval>;
  private readonly maxAgeMs: number;
  private readonly intervalMs: number;

  constructor(
    private store: SessionStore,
    private config: ReaperConfig,
  ) {
    this.maxAgeMs = config.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  start(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => {
        logger.error("Session reaper sweep failed", err);
      });
    }, this.intervalMs);
    this.timer.unref();
    logger.info(
      `Session reaper started (prefixes=${this.config.prefixes.join(",")}, interval=${this.intervalMs}ms)`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    logger.info("Session reaper stopped");
  }

  async sweep(now = Date.now()): Promise<number> {
    const sessions = this.store.list();
    let reaped = 0;

    for (const session of sessions) {
      const matches = this.config.prefixes.some((prefix) => session.sessionKey.startsWith(prefix));
      if (!matches) {
        continue;
      }

      const age = now - session.lastActiveAt;
      if (age < this.maxAgeMs) {
        continue;
      }

      // Delete transcript file if it exists
      if (session.transcriptPath) {
        try {
          await fs.unlink(session.transcriptPath);
          logger.debug(`Deleted transcript: ${session.transcriptPath}`);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") {
            logger.warn(`Failed to delete transcript ${session.transcriptPath}: ${code ?? err}`);
          }
        }
      }

      // Delete task output directory if it exists
      if (session.taskDir) {
        try {
          await fs.rm(session.taskDir, { recursive: true, force: true });
          logger.debug(`Deleted task dir: ${session.taskDir}`);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") {
            logger.warn(`Failed to delete task dir ${session.taskDir}: ${code ?? err}`);
          }
        }
      }

      this.store.delete(session.sessionKey);
      reaped++;
      logger.debug(`Reaped session: ${session.sessionKey} (age=${Math.round(age / 60_000)}min)`);
    }

    if (reaped > 0) {
      await this.store.save();
      logger.info(`Reaped ${reaped} expired sessions`);
    }

    return reaped;
  }
}
