export const SETUP_STEP_NAMES = [
  "prerequisites",
  "dependencies",
  "assistantName",
  "apiKeys",
  "bootstrap",
  "whatsapp",
  "telegram",
  "sandbox",
  "verify",
] as const;

export type SetupStepName = (typeof SETUP_STEP_NAMES)[number];

export const SETUP_STEP_STATUSES = ["pending", "completed", "skipped", "blocked"] as const;

export type SetupStepStatus = (typeof SETUP_STEP_STATUSES)[number];

export type SetupStepMap = Record<SetupStepName, SetupStepStatus>;

export interface SetupState {
  version: 1;
  updatedAt: string;
  assistantName: string;
  blockedReason: string | null;
  steps: SetupStepMap;
}
