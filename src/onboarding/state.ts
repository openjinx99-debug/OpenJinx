import fs from "node:fs/promises";
import path from "node:path";
import { homeRelative, ensureHomeDir } from "../infra/home-dir.js";
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from "../infra/security.js";
import {
  SETUP_STEP_NAMES,
  SETUP_STEP_STATUSES,
  type SetupState,
  type SetupStepMap,
  type SetupStepName,
  type SetupStepStatus,
} from "../types/onboarding.js";

export const SETUP_STATE_VERSION = 1;
export const DEFAULT_ASSISTANT_NAME = "Jinx";

function nowIso(): string {
  return new Date().toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStepStatus(value: unknown): value is SetupStepStatus {
  return typeof value === "string" && (SETUP_STEP_STATUSES as readonly string[]).includes(value);
}

export function isSetupStepName(value: string): value is SetupStepName {
  return (SETUP_STEP_NAMES as readonly string[]).includes(value);
}

function defaultSteps(): SetupStepMap {
  return {
    prerequisites: "pending",
    dependencies: "pending",
    assistantName: "pending",
    apiKeys: "pending",
    bootstrap: "pending",
    whatsapp: "pending",
    telegram: "pending",
    sandbox: "pending",
    verify: "pending",
  };
}

export function createDefaultSetupState(assistantName = DEFAULT_ASSISTANT_NAME): SetupState {
  return {
    version: SETUP_STATE_VERSION,
    updatedAt: nowIso(),
    assistantName,
    blockedReason: null,
    steps: defaultSteps(),
  };
}

function normalizeSetupState(raw: unknown): SetupState {
  if (!isObject(raw)) {
    throw new Error("Invalid setup-state: expected object");
  }

  const state = createDefaultSetupState();
  if (typeof raw.assistantName === "string" && raw.assistantName.trim().length > 0) {
    state.assistantName = raw.assistantName.trim();
  }
  if (typeof raw.updatedAt === "string" && raw.updatedAt.trim().length > 0) {
    state.updatedAt = raw.updatedAt;
  }
  if (typeof raw.blockedReason === "string") {
    state.blockedReason = raw.blockedReason;
  } else if (raw.blockedReason === null) {
    state.blockedReason = null;
  }

  if (isObject(raw.steps)) {
    for (const step of SETUP_STEP_NAMES) {
      const status = raw.steps[step];
      if (isStepStatus(status)) {
        state.steps[step] = status;
      }
    }
  }

  return state;
}

async function writeSetupState(state: SetupState): Promise<SetupState> {
  const filePath = resolveSetupStatePath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true, mode: SECURE_DIR_MODE });

  const next: SetupState = {
    ...state,
    version: SETUP_STATE_VERSION,
    updatedAt: nowIso(),
  };

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf-8",
    mode: SECURE_FILE_MODE,
  });
  await fs.rename(tempPath, filePath);
  return next;
}

async function backupInvalidState(filePath: string): Promise<void> {
  const backupPath = `${filePath}.invalid-${Date.now()}`;
  await fs.rename(filePath, backupPath);
}

export function resolveSetupStatePath(): string {
  return homeRelative("setup-state.json");
}

/**
 * Read setup state if it exists.
 * Returns undefined when the file does not exist.
 */
export async function readSetupState(): Promise<SetupState | undefined> {
  const filePath = resolveSetupStatePath();
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as unknown;
  return normalizeSetupState(parsed);
}

/**
 * Ensure setup-state exists and is valid.
 * If missing, creates defaults.
 * If invalid JSON/shape, rotates invalid file and recreates defaults.
 */
export async function ensureSetupState(options?: { assistantName?: string }): Promise<SetupState> {
  ensureHomeDir();
  const filePath = resolveSetupStatePath();

  let state: SetupState | undefined;
  try {
    state = await readSetupState();
  } catch {
    try {
      await backupInvalidState(filePath);
    } catch {
      // If backup fails, proceed to rewrite default state.
    }
    state = undefined;
  }

  if (!state) {
    return writeSetupState(
      createDefaultSetupState(options?.assistantName ?? DEFAULT_ASSISTANT_NAME),
    );
  }

  if (options?.assistantName && options.assistantName.trim().length > 0) {
    state.assistantName = options.assistantName.trim();
  }
  return writeSetupState(state);
}

export async function setSetupAssistantName(name: string): Promise<SetupState> {
  const state = await ensureSetupState();
  const nextName = name.trim();
  if (nextName.length === 0) {
    throw new Error("Assistant name must not be empty");
  }
  state.assistantName = nextName;
  return writeSetupState(state);
}

export async function setSetupBlockedReason(reason: string | null): Promise<SetupState> {
  const state = await ensureSetupState();
  state.blockedReason = reason;
  return writeSetupState(state);
}

export async function setSetupStep(
  step: SetupStepName,
  status: SetupStepStatus,
  options?: { reason?: string; clearReason?: boolean },
): Promise<SetupState> {
  const state = await ensureSetupState();
  state.steps[step] = status;

  if (options?.clearReason) {
    state.blockedReason = null;
  } else if (typeof options?.reason === "string") {
    state.blockedReason = options.reason;
  } else if (status === "blocked" && !state.blockedReason) {
    state.blockedReason = `Blocked at step: ${step}`;
  }

  return writeSetupState(state);
}
