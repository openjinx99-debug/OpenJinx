import type { ClaudeModelId, ClaudeModelTier, ModelRef } from "../types/config.js";

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

/** Check if a model ref routes to Ollama. */
export function isOllamaModel(ref: ModelRef): boolean {
  return ref === "ollama";
}

/** Resolve a model ID to the full Claude API model string. Throws for "ollama". */
export function resolveModelString(modelId: ModelRef): string {
  if (modelId === "ollama") {
    return "ollama"; // Not a Claude model — caller should route to Ollama provider
  }
  return MODEL_ID_MAP[modelId];
}

/** Resolve a model tier to a model ref using config or defaults. */
export function resolveModelForTier(
  tier: ClaudeModelTier,
  config?: Partial<Record<ClaudeModelTier, ModelRef>>,
): ModelRef {
  return config?.[tier] ?? TIER_DEFAULTS[tier];
}

/** Context window sizes per Claude model. */
const CONTEXT_WINDOWS: Record<ClaudeModelId, number> = {
  opus: 1_000_000,
  sonnet: 1_000_000,
  haiku: 200_000,
};

/** Get context window size for a model. */
export function getContextWindow(modelId: ModelRef): number {
  if (modelId === "ollama") {
    // Qwen 3.5 supports 128K context; conservative default
    return 128_000;
  }
  return CONTEXT_WINDOWS[modelId] ?? 200_000;
}

/** Max output tokens per model (text output only, excluding thinking). */
const MAX_OUTPUT_TOKENS: Record<ClaudeModelId, number> = {
  opus: 128_000,
  sonnet: 64_000,
  haiku: 64_000,
};

/** Get the max output tokens for a model. */
export function getMaxOutputTokens(modelId: ModelRef): number {
  if (modelId === "ollama") {
    return 8_192;
  }
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
export function supportsThinking(modelId: ModelRef): boolean {
  if (modelId === "ollama") {
    return false;
  }
  return THINKING_MODELS.has(modelId);
}

/** Get the thinking budget for a model. Returns 0 if thinking not supported. */
export function getThinkingBudget(modelId: ModelRef): number {
  if (modelId === "ollama") {
    return 0;
  }
  return THINKING_BUDGET[modelId] ?? 0;
}

/** Check if a model ID is a valid Claude model. */
export function isValidModelId(id: string): id is ClaudeModelId {
  return id === "opus" || id === "sonnet" || id === "haiku";
}

/** Check if a string is a valid model ref (Claude or Ollama). */
export function isValidModelRef(id: string): id is ModelRef {
  return id === "opus" || id === "sonnet" || id === "haiku" || id === "ollama";
}
