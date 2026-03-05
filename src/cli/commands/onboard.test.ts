import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WizardIO } from "./onboard.js";

vi.mock("../../infra/home-dir.js", () => ({
  resolveHomeDir: vi.fn(() => "/tmp/.jinx"),
  ensureHomeDir: vi.fn(),
  homeRelative: vi.fn((p: string) => `/tmp/.jinx/${p}`),
}));

vi.mock("../../onboarding/state.js", () => ({
  ensureSetupState: vi.fn(),
  setSetupStep: vi.fn().mockResolvedValue({}),
  setSetupAssistantName: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../providers/auth.js", () => ({
  hasAuth: vi.fn(() => true),
  resolveAuth: vi.fn(() => ({ mode: "api-key", key: "sk-ant-test" })),
}));

vi.mock("../../workspace/bootstrap.js", () => ({
  ensureWorkspace: vi.fn().mockResolvedValue(undefined),
  populateIdentityName: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../config/validation.js", () => ({
  loadAndValidateConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../config/loader.js", () => ({
  loadRawConfig: vi.fn().mockResolvedValue({}),
  resolveConfigPath: vi.fn(() => "/tmp/.jinx/config.yaml"),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

type StepKey =
  | "prerequisites"
  | "dependencies"
  | "assistantName"
  | "apiKeys"
  | "bootstrap"
  | "whatsapp"
  | "telegram"
  | "sandbox"
  | "verify";

function makeState(
  overrides: { assistantName?: string; steps?: Partial<Record<StepKey, string>> } = {},
) {
  return {
    version: 1 as const,
    updatedAt: new Date().toISOString(),
    assistantName: overrides.assistantName ?? "Jinx",
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
      ...overrides.steps,
    },
  };
}

function makeMockIO(overrides: Partial<WizardIO> = {}): WizardIO {
  return {
    ask: vi.fn((_prompt: string, def?: string) => Promise.resolve(def ?? "")),
    askSecret: vi.fn(() => Promise.resolve("")),
    confirm: vi.fn(() => Promise.resolve(false)),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runOnboard", () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-onboard-test-"));

    const { ensureSetupState } = await import("../../onboarding/state.js");
    vi.mocked(ensureSetupState).mockResolvedValue(makeState());
  });

  afterEach(async () => {
    const fsp = await import("node:fs/promises");
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it("skips assistantName step when already completed", async () => {
    const { ensureSetupState, setSetupAssistantName } = await import("../../onboarding/state.js");
    vi.mocked(ensureSetupState).mockResolvedValue(
      makeState({ steps: { assistantName: "completed" } }),
    );

    const io = makeMockIO();
    const { runOnboard } = await import("./onboard.js");
    await runOnboard(io, tmpDir);

    expect(vi.mocked(io.ask)).not.toHaveBeenCalledWith(
      expect.stringContaining("What should I call"),
      expect.anything(),
    );
    expect(setSetupAssistantName).not.toHaveBeenCalled();
  });

  it("skips apiKeys step when hasAuth returns true and step completed", async () => {
    const { ensureSetupState } = await import("../../onboarding/state.js");
    vi.mocked(ensureSetupState).mockResolvedValue(makeState({ steps: { apiKeys: "completed" } }));
    const { hasAuth } = await import("../../providers/auth.js");
    vi.mocked(hasAuth).mockReturnValue(true);

    const io = makeMockIO();
    const { runOnboard } = await import("./onboard.js");
    await runOnboard(io, tmpDir);

    expect(vi.mocked(io.askSecret)).not.toHaveBeenCalledWith(
      expect.stringContaining("ANTHROPIC_API_KEY"),
    );
    expect(vi.mocked(io.ask)).not.toHaveBeenCalledWith(
      expect.stringContaining("[1] Enter API key"),
      expect.anything(),
    );
  });

  it("writes API key to .env on user input", async () => {
    const { ensureSetupState } = await import("../../onboarding/state.js");
    vi.mocked(ensureSetupState).mockResolvedValue(makeState());

    const { hasAuth, resolveAuth } = await import("../../providers/auth.js");
    vi.mocked(hasAuth).mockReturnValue(false);
    vi.mocked(resolveAuth).mockReturnValue({ mode: "api-key", key: "sk-ant-mykey" });

    const io = makeMockIO({
      ask: vi.fn((prompt: string, def?: string) => {
        if (prompt.includes("[1] Enter API key")) {
          return Promise.resolve("1");
        }
        return Promise.resolve(def ?? "");
      }),
      askSecret: vi.fn(() => Promise.resolve("sk-ant-mykey")),
      confirm: vi.fn(() => Promise.resolve(false)),
    });

    const { runOnboard } = await import("./onboard.js");
    await runOnboard(io, tmpDir);

    const envPath = path.join(tmpDir, ".env");
    expect(fs.existsSync(envPath)).toBe(true);
    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("ANTHROPIC_API_KEY=sk-ant-mykey");
  });

  it("does not duplicate existing key when upserting .env", async () => {
    // Pre-write .env with an existing key
    const envPath = path.join(tmpDir, ".env");
    fs.writeFileSync(envPath, "ANTHROPIC_API_KEY=sk-ant-existing\n", { mode: 0o600 });

    const { ensureSetupState } = await import("../../onboarding/state.js");
    vi.mocked(ensureSetupState).mockResolvedValue(makeState());

    const { hasAuth, resolveAuth } = await import("../../providers/auth.js");
    vi.mocked(hasAuth).mockReturnValue(false);
    vi.mocked(resolveAuth).mockReturnValue({ mode: "api-key", key: "sk-ant-new" });

    const io = makeMockIO({
      ask: vi.fn((prompt: string, def?: string) => {
        if (prompt.includes("[1] Enter API key")) {
          return Promise.resolve("1");
        }
        return Promise.resolve(def ?? "");
      }),
      askSecret: vi.fn(() => Promise.resolve("sk-ant-new")),
      confirm: vi.fn(() => Promise.resolve(false)),
    });

    const { runOnboard } = await import("./onboard.js");
    await runOnboard(io, tmpDir);

    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("ANTHROPIC_API_KEY=sk-ant-new");
    // Upsert must not duplicate the key
    const matches = content.match(/ANTHROPIC_API_KEY=/g);
    expect(matches?.length).toBe(1);
  });

  it("marks all required steps completed on happy path", async () => {
    const { ensureSetupState, setSetupStep, setSetupAssistantName } =
      await import("../../onboarding/state.js");
    vi.mocked(ensureSetupState).mockResolvedValue(makeState());

    const { hasAuth } = await import("../../providers/auth.js");
    vi.mocked(hasAuth).mockReturnValue(true);

    const io = makeMockIO({
      ask: vi.fn((_prompt: string, def?: string) => Promise.resolve(def ?? "Jinx")),
      confirm: vi.fn(() => Promise.resolve(false)),
    });

    const { runOnboard } = await import("./onboard.js");
    await runOnboard(io, tmpDir);

    expect(setSetupStep).toHaveBeenCalledWith("prerequisites", "completed");
    expect(setSetupStep).toHaveBeenCalledWith("dependencies", "completed");
    expect(setSetupAssistantName).toHaveBeenCalled();
    expect(setSetupStep).toHaveBeenCalledWith("assistantName", "completed");
    expect(setSetupStep).toHaveBeenCalledWith("apiKeys", "completed");
    expect(setSetupStep).toHaveBeenCalledWith("bootstrap", "completed");
    expect(setSetupStep).toHaveBeenCalledWith("verify", "completed");
  });
});
