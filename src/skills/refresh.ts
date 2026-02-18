import fs from "node:fs";
import type { SkillEntry } from "../types/skills.js";
import { expandTilde } from "../infra/home-dir.js";
import { createLogger } from "../infra/logger.js";
import { loadSkillEntries } from "./loader.js";

const logger = createLogger("skills");

export type SkillRefreshCallback = (skills: SkillEntry[]) => void;

/**
 * Periodically reload skills from disk.
 * Also sets up fs.watch() on each skill directory for near-instant detection.
 * Returns a stop function.
 */
export function startSkillRefresh(
  dirs: string[],
  callback: SkillRefreshCallback,
  intervalMs = 30_000,
): () => void {
  let timer: ReturnType<typeof setInterval>;
  let lastCount = -1;

  const refresh = async () => {
    try {
      const skills = await loadSkillEntries(dirs);
      if (skills.length !== lastCount) {
        logger.info(`Skills refreshed: ${skills.length} skills loaded`);
        lastCount = skills.length;
      }
      callback(skills);
    } catch (err) {
      logger.warn(`Failed to refresh skills: ${err}`);
    }
  };

  // Polling interval as a baseline
  timer = setInterval(refresh, intervalMs);
  timer.unref();

  // fs.watch() for near-instant detection
  const watchers = startSkillWatcher(dirs, refresh);

  logger.info(`Skill refresh started (interval=${intervalMs}ms, watchers=${watchers.length})`);

  return () => {
    clearInterval(timer);
    for (const w of watchers) {
      w.close();
    }
    logger.info("Skill refresh stopped");
  };
}

/** Debounce delay for fs.watch events (ms). */
const WATCH_DEBOUNCE_MS = 500;

/**
 * Set up fs.watch() on each skill directory for near-instant detection.
 * Debounces rapid changes (multiple file writes within WATCH_DEBOUNCE_MS).
 * Falls back gracefully if fs.watch() fails on a directory.
 */
export function startSkillWatcher(dirs: string[], callback: () => void): fs.FSWatcher[] {
  const watchers: fs.FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const debouncedCallback = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      callback();
    }, WATCH_DEBOUNCE_MS);
  };

  for (const dir of dirs) {
    const watchDir = expandTilde(dir);
    try {
      const watcher = fs.watch(watchDir, { recursive: true }, () => {
        debouncedCallback();
      });
      watcher.on("error", (err) => {
        logger.warn(`fs.watch error on ${watchDir}: ${err}`);
      });
      watchers.push(watcher);
    } catch (err) {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code?: unknown }).code)
          : undefined;
      if (code === "ENOENT") {
        // Optional directory: polling still loads skills if it appears later.
        logger.debug(`Skills directory missing for watch (${watchDir}), using polling only`);
      } else {
        logger.warn(`Failed to watch ${watchDir}, falling back to polling: ${err}`);
      }
    }
  }

  return watchers;
}
