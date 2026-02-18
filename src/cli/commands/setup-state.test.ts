import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../onboarding/state.js", () => ({
  ensureSetupState: vi.fn().mockResolvedValue({
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    assistantName: "Jinx",
    blockedReason: null,
    steps: {
      prerequisites: "pending",
      dependencies: "pending",
      assistantName: "pending",
      apiKeys: "pending",
      bootstrap: "pending",
      whatsapp: "pending",
      telegram: "pending",
      sandbox: "pending",
      verify: "pending",
    },
  }),
  isSetupStepName: vi.fn((value: string) =>
    [
      "prerequisites",
      "dependencies",
      "assistantName",
      "apiKeys",
      "bootstrap",
      "whatsapp",
      "telegram",
      "sandbox",
      "verify",
    ].includes(value),
  ),
  resolveSetupStatePath: vi.fn(() => "/tmp/.jinx/setup-state.json"),
  readSetupState: vi.fn().mockResolvedValue({
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    assistantName: "Jinx",
    blockedReason: null,
    steps: {
      prerequisites: "pending",
      dependencies: "pending",
      assistantName: "pending",
      apiKeys: "pending",
      bootstrap: "pending",
      whatsapp: "pending",
      telegram: "pending",
      sandbox: "pending",
      verify: "pending",
    },
  }),
  setSetupAssistantName: vi.fn().mockResolvedValue({
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    assistantName: "Nova",
    blockedReason: null,
    steps: {
      prerequisites: "pending",
      dependencies: "pending",
      assistantName: "completed",
      apiKeys: "pending",
      bootstrap: "pending",
      whatsapp: "pending",
      telegram: "pending",
      sandbox: "pending",
      verify: "pending",
    },
  }),
  setSetupBlockedReason: vi.fn().mockResolvedValue({
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    assistantName: "Jinx",
    blockedReason: "Blocked",
    steps: {
      prerequisites: "pending",
      dependencies: "pending",
      assistantName: "pending",
      apiKeys: "blocked",
      bootstrap: "pending",
      whatsapp: "pending",
      telegram: "pending",
      sandbox: "pending",
      verify: "pending",
    },
  }),
  setSetupStep: vi.fn().mockResolvedValue({
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    assistantName: "Jinx",
    blockedReason: null,
    steps: {
      prerequisites: "completed",
      dependencies: "pending",
      assistantName: "pending",
      apiKeys: "pending",
      bootstrap: "pending",
      whatsapp: "pending",
      telegram: "pending",
      sandbox: "pending",
      verify: "pending",
    },
  }),
}));

describe("setupStateCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  it("init calls ensureSetupState with optional assistant name", async () => {
    const { setupStateCommand } = await import("./setup-state.js");
    const { ensureSetupState } = await import("../../onboarding/state.js");

    await setupStateCommand.parseAsync(["node", "setup-state", "init", "--name", "Nova"]);

    expect(ensureSetupState).toHaveBeenCalledWith({ assistantName: "Nova" });
  });

  it("set-step validates and forwards arguments", async () => {
    const { setupStateCommand } = await import("./setup-state.js");
    const { setSetupStep } = await import("../../onboarding/state.js");

    await setupStateCommand.parseAsync([
      "node",
      "setup-state",
      "set-step",
      "prerequisites",
      "completed",
      "--clear-reason",
    ]);

    expect(setSetupStep).toHaveBeenCalledWith("prerequisites", "completed", {
      reason: undefined,
      clearReason: true,
    });
  });

  it("rejects invalid step names", async () => {
    const { setupStateCommand } = await import("./setup-state.js");
    const { setSetupStep } = await import("../../onboarding/state.js");

    await setupStateCommand.parseAsync([
      "node",
      "setup-state",
      "set-step",
      "not-a-step",
      "completed",
    ]);

    expect(setSetupStep).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("show exits with code 1 when state is missing", async () => {
    const { setupStateCommand } = await import("./setup-state.js");
    const { readSetupState } = await import("../../onboarding/state.js");
    vi.mocked(readSetupState).mockResolvedValueOnce(undefined);

    await setupStateCommand.parseAsync(["node", "setup-state", "show"]);

    expect(process.exitCode).toBe(1);
  });
});
