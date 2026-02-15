import { createLogger } from "../infra/logger.js";
import { filterSafeEnvOverrides } from "../infra/security.js";

const logger = createLogger("env-overrides");

/**
 * Apply environment variable overrides for a skill execution.
 * Returns a cleanup function that restores the original values.
 * Dangerous environment variables are blocked and logged as warnings.
 */
export function applyEnvOverrides(overrides: Record<string, string>): () => void {
  const { safe, blocked } = filterSafeEnvOverrides(overrides);

  if (blocked.length > 0) {
    logger.warn(`Blocked dangerous env var overrides: ${blocked.join(", ")}`);
  }

  const originals = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(safe)) {
    originals.set(key, process.env[key]);
    process.env[key] = value;
  }

  return () => {
    for (const [key, original] of originals) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  };
}
