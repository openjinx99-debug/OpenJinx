import type { JinxConfig } from "../types/config.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";

/**
 * Create a test configuration with deep-merged overrides.
 */
export function createTestConfig(overrides?: DeepPartial<JinxConfig>): JinxConfig {
  if (!overrides) {
    return structuredClone(DEFAULT_CONFIG);
  }
  return deepMerge(
    structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>,
    overrides as unknown as Record<string, unknown>,
  ) as unknown as JinxConfig;
}

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      result[key] = sv;
    }
  }
  return result;
}
