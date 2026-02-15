import type { JinxConfig } from "../types/config.js";
import { loadRawConfig } from "./loader.js";
import { jinxConfigSchema, type JinxConfigInput } from "./schema.js";

export interface ValidationResult {
  ok: boolean;
  config?: JinxConfig;
  errors?: string[];
}

/** Validate raw input against the Jinx config schema. */
export function validateConfig(raw: unknown): ValidationResult {
  const result = jinxConfigSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, config: result.data as JinxConfig };
  }
  const errors = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  return { ok: false, errors };
}

/** Load config from disk, validate, and return a fully-resolved JinxConfig. */
export async function loadAndValidateConfig(filePath?: string): Promise<JinxConfig> {
  const raw = await loadRawConfig(filePath);
  const result = validateConfig(raw);
  if (!result.ok) {
    throw new Error(`Invalid config:\n${result.errors!.join("\n")}`);
  }
  return result.config!;
}

/** Parse partial config input and merge with defaults. */
export function parsePartialConfig(input: JinxConfigInput): JinxConfig {
  return jinxConfigSchema.parse(input) as JinxConfig;
}
