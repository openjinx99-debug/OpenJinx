import util from "node:util";
import type { LogLevel } from "../types/config.js";
import { redactSecrets } from "./security.js";

/**
 * Prefixes of console messages from @whiskeysockets/libsignal-node that dump
 * raw cryptographic session data (private keys, root keys, etc.) to stdout.
 * We suppress these to avoid leaking sensitive material.
 */
const SUPPRESSED_CONSOLE_PREFIXES = [
  "Closing session:",
  "Opening session:",
  "Removing old closed session:",
  "Session already closed",
  "Session already open",
] as const;

function isSuppressedMessage(args: unknown[]): boolean {
  const formatted = util.format(...args);
  return SUPPRESSED_CONSOLE_PREFIXES.some((prefix) => formatted.startsWith(prefix));
}

let consoleSuppressed = false;

/**
 * Patch console.info/warn to suppress libsignal-node messages that leak
 * cryptographic session keys. Call once at startup before WhatsApp connects.
 */
export function suppressSensitiveLogs(): void {
  if (consoleSuppressed) {
    return;
  }
  consoleSuppressed = true;

  const origInfo = console.info;
  const origWarn = console.warn;

  console.info = (...args: unknown[]) => {
    if (isSuppressedMessage(args)) {
      return;
    }
    origInfo.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    if (isSuppressedMessage(args)) {
      return;
    }
    origWarn.apply(console, args);
  };
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log: Logger = {
  debug(msg, ...args) {
    if (shouldLog("debug")) {
      console.debug(`${formatTimestamp()} [DBG] ${redactSecrets(msg)}`, ...args);
    }
  },
  info(msg, ...args) {
    if (shouldLog("info")) {
      console.info(`${formatTimestamp()} [INF] ${redactSecrets(msg)}`, ...args);
    }
  },
  warn(msg, ...args) {
    if (shouldLog("warn")) {
      console.warn(`${formatTimestamp()} [WRN] ${redactSecrets(msg)}`, ...args);
    }
  },
  error(msg, ...args) {
    if (shouldLog("error")) {
      console.error(`${formatTimestamp()} [ERR] ${redactSecrets(msg)}`, ...args);
    }
  },
};

/** Create a child logger with a prefix. */
export function createLogger(prefix: string): Logger {
  return {
    debug: (msg, ...args) => log.debug(`[${prefix}] ${msg}`, ...args),
    info: (msg, ...args) => log.info(`[${prefix}] ${msg}`, ...args),
    warn: (msg, ...args) => log.warn(`[${prefix}] ${msg}`, ...args),
    error: (msg, ...args) => log.error(`[${prefix}] ${msg}`, ...args),
  };
}
