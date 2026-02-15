import JSON5 from "json5";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { resolveHomeDir } from "../infra/home-dir.js";
import { createLogger } from "../infra/logger.js";

/** Resolve the config file path from env or default. */
export function resolveConfigPath(): string {
  if (process.env.JINX_CONFIG) {
    return path.resolve(process.env.JINX_CONFIG);
  }
  return path.join(resolveHomeDir(), "config.yaml");
}

/** Load raw config object from disk. Returns empty object if file doesn't exist. */
export async function loadRawConfig(filePath?: string): Promise<Record<string, unknown>> {
  const configPath = filePath ?? resolveConfigPath();

  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return {};
    }
    throw new Error(`Failed to read config at ${configPath}: ${String(err)}`, { cause: err });
  }

  // Warn if config file is group/world readable (unix-like only)
  if (process.platform === "darwin" || process.platform === "linux") {
    try {
      const fileStat = await fs.stat(configPath);
      if (fileStat.mode & 0o044) {
        const logger = createLogger("config");
        logger.warn(
          `Config file ${configPath} is group/world readable. Consider running: chmod 600 ${configPath}`,
        );
      }
    } catch {
      // Ignore stat errors — the file was just read successfully
    }
  }

  const ext = path.extname(configPath).toLowerCase();

  if (ext === ".yaml" || ext === ".yml") {
    return (YAML.parse(content) as Record<string, unknown>) ?? {};
  }

  if (ext === ".json" || ext === ".json5") {
    return JSON5.parse(content) as Record<string, unknown>;
  }

  // Try YAML first, fall back to JSON5
  try {
    return (YAML.parse(content) as Record<string, unknown>) ?? {};
  } catch {
    return JSON5.parse(content) as Record<string, unknown>;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
