import { Command } from "commander";
import type { SetupState, SetupStepStatus } from "../../types/onboarding.js";
import {
  ensureSetupState,
  isSetupStepName,
  resolveSetupStatePath,
  readSetupState,
  setSetupAssistantName,
  setSetupBlockedReason,
  setSetupStep,
} from "../../onboarding/state.js";

const STEP_STATUSES: readonly SetupStepStatus[] = ["pending", "completed", "skipped", "blocked"];

function isSetupStepStatus(value: string): value is SetupStepStatus {
  return (STEP_STATUSES as readonly string[]).includes(value);
}

function printState(state: SetupState, asJson = false): void {
  if (asJson) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  console.log(`Setup state file: ${resolveSetupStatePath()}`);
  console.log(`Updated: ${state.updatedAt}`);
  console.log(`Assistant: ${state.assistantName}`);
  console.log(`Blocked reason: ${state.blockedReason ?? "none"}`);
  console.log("Steps:");
  for (const [step, status] of Object.entries(state.steps)) {
    console.log(`  ${step}: ${status}`);
  }
}

export const setupStateCommand = new Command("setup-state")
  .description("Manage onboarding setup-state (~/.jinx/setup-state.json)")
  .addCommand(
    new Command("init")
      .description("Initialize setup-state if missing; normalize if present")
      .option("-n, --name <assistantName>", "assistant name")
      .option("--json", "output JSON")
      .action(async (opts: { name?: string; json?: boolean }) => {
        const state = await ensureSetupState({ assistantName: opts.name });
        printState(state, !!opts.json);
      }),
  )
  .addCommand(
    new Command("show")
      .description("Show current setup-state")
      .option("--json", "output JSON")
      .action(async (opts: { json?: boolean }) => {
        const state = await readSetupState();
        if (!state) {
          console.log("Setup state file not found. Run `pnpm dev -- setup-state init`.");
          process.exitCode = 1;
          return;
        }
        printState(state, !!opts.json);
      }),
  )
  .addCommand(
    new Command("set-name")
      .description("Set assistant name in setup-state")
      .argument("<assistantName>", "assistant name")
      .option("--json", "output JSON")
      .action(async (assistantName: string, opts: { json?: boolean }) => {
        const state = await setSetupAssistantName(assistantName);
        printState(state, !!opts.json);
      }),
  )
  .addCommand(
    new Command("set-step")
      .description("Set a setup step status")
      .argument("<step>", "setup step name")
      .argument("<status>", "pending | completed | skipped | blocked")
      .option("--reason <text>", "blocked reason or note")
      .option("--clear-reason", "clear blocked reason")
      .option("--json", "output JSON")
      .action(
        async (
          step: string,
          status: string,
          opts: { reason?: string; clearReason?: boolean; json?: boolean },
        ) => {
          if (!isSetupStepName(step)) {
            console.error(`Invalid step: ${step}`);
            process.exitCode = 1;
            return;
          }
          if (!isSetupStepStatus(status)) {
            console.error(`Invalid status: ${status}`);
            process.exitCode = 1;
            return;
          }
          const state = await setSetupStep(step, status, {
            reason: opts.reason,
            clearReason: !!opts.clearReason,
          });
          printState(state, !!opts.json);
        },
      ),
  )
  .addCommand(
    new Command("set-block")
      .description("Set blocked reason without changing step status")
      .argument("<reason>", "blocked reason")
      .option("--json", "output JSON")
      .action(async (reason: string, opts: { json?: boolean }) => {
        const state = await setSetupBlockedReason(reason);
        printState(state, !!opts.json);
      }),
  )
  .addCommand(
    new Command("clear-block")
      .description("Clear blocked reason")
      .option("--json", "output JSON")
      .action(async (opts: { json?: boolean }) => {
        const state = await setSetupBlockedReason(null);
        printState(state, !!opts.json);
      }),
  );
