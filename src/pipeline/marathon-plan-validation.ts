import type { ChunkDefinition } from "../types/marathon.js";

export const ACCEPTANCE_FORMAT_HINT =
  "Supported formats: file_exists: <path>, command_succeeds: <command>, file_contains: <path> :: <text>, tests_pass";

export interface ChunkValidationOptions {
  minAcceptanceCriteria: number;
  maxAcceptanceCriteria: number;
  requireMachineVerifiableCriteria: boolean;
}

const DEFAULT_CHUNK_VALIDATION_OPTIONS: ChunkValidationOptions = {
  minAcceptanceCriteria: 1,
  maxAcceptanceCriteria: 5,
  requireMachineVerifiableCriteria: true,
};

export interface ChunkValidationResult {
  chunk?: ChunkDefinition;
  errors: string[];
}

export function isMachineVerifiableCriterion(criterion: string): boolean {
  const trimmed = criterion.trim();
  if (trimmed === "tests_pass") {
    return true;
  }
  if (trimmed.startsWith("file_exists:")) {
    return trimmed.slice("file_exists:".length).trim().length > 0;
  }
  if (trimmed.startsWith("command_succeeds:")) {
    return trimmed.slice("command_succeeds:".length).trim().length > 0;
  }
  if (trimmed.startsWith("file_contains:")) {
    const rest = trimmed.slice("file_contains:".length).trim();
    const sep = rest.indexOf("::");
    return sep > 0 && rest.slice(0, sep).trim().length > 0 && rest.slice(sep + 2).trim().length > 0;
  }
  return false;
}

export function validateChunkDefinition(
  raw: unknown,
  chunkIndex: number,
  options: Partial<ChunkValidationOptions> = {},
): ChunkValidationResult {
  const resolved: ChunkValidationOptions = {
    ...DEFAULT_CHUNK_VALIDATION_OPTIONS,
    ...options,
  };
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    errors.push(`chunks[${chunkIndex}] must be an object.`);
    return { errors };
  }

  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
  const estimatedMinutes =
    typeof obj.estimatedMinutes === "number" && Number.isFinite(obj.estimatedMinutes)
      ? obj.estimatedMinutes
      : NaN;
  const acceptanceCriteriaRaw = obj.acceptanceCriteria;
  const acceptanceCriteria = Array.isArray(acceptanceCriteriaRaw)
    ? acceptanceCriteriaRaw
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
    : [];

  if (!name) {
    errors.push(`chunks[${chunkIndex}].name must be a non-empty string.`);
  }
  if (!prompt) {
    errors.push(`chunks[${chunkIndex}].prompt must be a non-empty string.`);
  }
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) {
    errors.push(`chunks[${chunkIndex}].estimatedMinutes must be a number greater than 0.`);
  }
  if (!Array.isArray(acceptanceCriteriaRaw)) {
    errors.push(`chunks[${chunkIndex}].acceptanceCriteria must be an array.`);
  } else {
    if (acceptanceCriteria.length < resolved.minAcceptanceCriteria) {
      errors.push(
        `chunks[${chunkIndex}].acceptanceCriteria must include at least ${resolved.minAcceptanceCriteria} item(s).`,
      );
    }
    if (acceptanceCriteria.length > resolved.maxAcceptanceCriteria) {
      errors.push(
        `chunks[${chunkIndex}].acceptanceCriteria must include at most ${resolved.maxAcceptanceCriteria} item(s).`,
      );
    }
    if (resolved.requireMachineVerifiableCriteria) {
      for (let c = 0; c < acceptanceCriteria.length; c++) {
        if (!isMachineVerifiableCriterion(acceptanceCriteria[c])) {
          errors.push(
            `chunks[${chunkIndex}].acceptanceCriteria[${c}] is not machine-verifiable: "${acceptanceCriteria[c]}"`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    chunk: {
      name,
      prompt,
      estimatedMinutes,
      acceptanceCriteria,
    },
    errors: [],
  };
}
