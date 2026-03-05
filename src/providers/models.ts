import type { ClaudeModelId, ClaudeModelTier } from "../types/config.js";

/** Map from our model IDs to the actual Claude API model strings. */
const MODEL_ID_MAP: Record<ClaudeModelId, string> = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

/** Map from model tier to default model ID. */
const TIER_DEFAULTS: Record<ClaudeModelTier, ClaudeModelId> = {
  brain: "sonnet",
  subagent: "sonnet",
  light: "haiku",
};

/** Resolve a model ID to the full Claude API model string. */
export function resolveModelString(modelId: ClaudeModelId): string {
  return MODEL_ID_MAP[modelId];
}

/** Resolve a model tier to a model ID using config or defaults. */
export function resolveModelForTier(
  tier: ClaudeModelTier,
  config?: Partial<Record<ClaudeModelTier, ClaudeModelId>>,
): ClaudeModelId {
  return config?.[tier] ?? TIER_DEFAULTS[tier];
}

/** Get context window size for a model. */
export function getContextWindow(_modelId: ClaudeModelId): number {
  // All current Claude models have 200K context
  return 200_000;
}

/** Max output tokens per model (text output only, excluding thinking). */
const MAX_OUTPUT_TOKENS: Record<ClaudeModelId, number> = {
  opus: 32_768,
  sonnet: 16_384,
  haiku: 8_192,
};

/** Get the max output tokens for a model. */
export function getMaxOutputTokens(modelId: ClaudeModelId): number {
  return MAX_OUTPUT_TOKENS[modelId] ?? 16_384;
}

/** Models that support extended thinking. */
const THINKING_MODELS: Set<ClaudeModelId> = new Set(["opus", "sonnet"]);

/** Thinking budget per model (tokens allocated to internal reasoning). */
const THINKING_BUDGET: Record<ClaudeModelId, number> = {
  opus: 10_000,
  sonnet: 8_000,
  haiku: 0,
};

/** Check if a model supports extended thinking. */
export function supportsThinking(modelId: ClaudeModelId): boolean {
  return THINKING_MODELS.has(modelId);
}

/** Get the thinking budget for a model. Returns 0 if thinking not supported. */
export function getThinkingBudget(modelId: ClaudeModelId): number {
  return THINKING_BUDGET[modelId] ?? 0;
}

/** Check if a model ID is valid. */
export function isValidModelId(id: string): id is ClaudeModelId {
  return id === "opus" || id === "sonnet" || id === "haiku";
}
