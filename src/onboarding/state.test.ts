import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultSetupState,
  ensureSetupState,
  readSetupState,
  resolveSetupStatePath,
  setSetupAssistantName,
  setSetupBlockedReason,
  setSetupStep,
} from "./state.js";

let tmpHome: string;
let savedJinxHome: string | undefined;

beforeEach(() => {
  savedJinxHome = process.env.JINX_HOME;
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "jinx-setup-state-"));
  process.env.JINX_HOME = tmpHome;
});

afterEach(async () => {
  if (savedJinxHome === undefined) {
    delete process.env.JINX_HOME;
  } else {
    process.env.JINX_HOME = savedJinxHome;
  }
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("setup state", () => {
  it("creates default state when missing", async () => {
    const state = await ensureSetupState();
    expect(state.version).toBe(1);
    expect(state.assistantName).toBe("Jinx");
    expect(state.blockedReason).toBeNull();
    expect(state.steps.verify).toBe("pending");

    const disk = JSON.parse(await fs.readFile(resolveSetupStatePath(), "utf-8")) as {
      version: number;
    };
    expect(disk.version).toBe(1);
  });

  it("applies assistant name override on ensure", async () => {
    const state = await ensureSetupState({ assistantName: "Nova" });
    expect(state.assistantName).toBe("Nova");
  });

  it("returns undefined when state file does not exist", async () => {
    const state = await readSetupState();
    expect(state).toBeUndefined();
  });

  it("sets step status and blocked reason", async () => {
    await ensureSetupState();
    const blocked = await setSetupStep("apiKeys", "blocked", {
      reason: "Claude auth missing",
    });
    expect(blocked.steps.apiKeys).toBe("blocked");
    expect(blocked.blockedReason).toBe("Claude auth missing");

    const cleared = await setSetupStep("apiKeys", "completed", { clearReason: true });
    expect(cleared.steps.apiKeys).toBe("completed");
    expect(cleared.blockedReason).toBeNull();
  });

  it("updates assistant name and blocked reason directly", async () => {
    await ensureSetupState();
    const named = await setSetupAssistantName("Orion");
    expect(named.assistantName).toBe("Orion");

    const blocked = await setSetupBlockedReason("Waiting for key");
    expect(blocked.blockedReason).toBe("Waiting for key");

    const cleared = await setSetupBlockedReason(null);
    expect(cleared.blockedReason).toBeNull();
  });

  it("rejects empty assistant name", async () => {
    await ensureSetupState();
    await expect(setSetupAssistantName("   ")).rejects.toThrow("Assistant name must not be empty");
  });

  it("recovers from invalid setup-state file by rotating it", async () => {
    await fs.mkdir(tmpHome, { recursive: true });
    const filePath = resolveSetupStatePath();
    await fs.writeFile(filePath, "{invalid-json", "utf-8");

    const state = await ensureSetupState();
    expect(state.version).toBe(1);
    expect(state.steps.prerequisites).toBe("pending");

    const files = await fs.readdir(tmpHome);
    const rotated = files.filter((name) => name.startsWith("setup-state.json.invalid-"));
    expect(rotated.length).toBe(1);
  });

  it("normalizes partial state files and preserves valid fields", async () => {
    const partial = {
      assistantName: "Astra",
      steps: {
        prerequisites: "completed",
        verify: "blocked",
      },
      blockedReason: "doctor failed",
    };
    await fs.mkdir(tmpHome, { recursive: true });
    await fs.writeFile(resolveSetupStatePath(), JSON.stringify(partial), "utf-8");

    const state = await ensureSetupState();
    expect(state.assistantName).toBe("Astra");
    expect(state.steps.prerequisites).toBe("completed");
    expect(state.steps.verify).toBe("blocked");
    expect(state.steps.whatsapp).toBe("pending");
    expect(state.blockedReason).toBe("doctor failed");
  });

  it("creates default state shape helper", () => {
    const state = createDefaultSetupState("Lyra");
    expect(state.assistantName).toBe("Lyra");
    expect(state.steps.bootstrap).toBe("pending");
  });
});
