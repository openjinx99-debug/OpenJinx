/**
 * Minimal silent logger compatible with Baileys' expected pino-like logger API.
 * This suppresses verbose internal socket chatter during unstable network periods.
 */
type BaileysLogger = {
  level?: string;
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  fatal: (...args: unknown[]) => void;
  child: () => BaileysLogger;
};

function noop(..._args: unknown[]): void {
  // intentionally empty
}

const silentLogger: BaileysLogger = {
  level: "silent",
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => silentLogger,
};

export const BAILEYS_SILENT_LOGGER = silentLogger;
