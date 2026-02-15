import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SECURE_DIR_MODE } from "./security.js";

const JINX_HOME_ENV = "JINX_HOME";
const DEFAULT_DIR_NAME = ".jinx";

/** Resolve the Jinx home directory (~/.jinx or $JINX_HOME). */
export function resolveHomeDir(): string {
  const envHome = process.env[JINX_HOME_ENV];
  if (envHome) {
    return path.resolve(envHome);
  }
  return path.join(os.homedir(), DEFAULT_DIR_NAME);
}

/** Ensure the Jinx home directory exists. */
export function ensureHomeDir(): string {
  const dir = resolveHomeDir();
  fs.mkdirSync(dir, { recursive: true, mode: SECURE_DIR_MODE });
  return dir;
}

/** Resolve a path relative to the Jinx home directory. */
export function homeRelative(relativePath: string): string {
  return path.join(resolveHomeDir(), relativePath);
}

/** Expand ~ prefix to the user's home directory. */
export function expandTilde(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}
