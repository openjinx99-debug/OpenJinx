import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { resolveHomeDir } from "./home-dir.js";

/**
 * Load environment variables from ~/.jinx/.env (or $JINX_HOME/.env).
 * Does not override env vars already present in the process.
 */
export function loadDotEnv(): void {
  const envPath = path.join(resolveHomeDir(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  dotenv.config({ path: envPath, override: false });
}
