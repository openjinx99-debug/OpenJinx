import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./loader.js", () => ({
  loadRawConfig: vi.fn(),
}));

import { loadRawConfig } from "./loader.js";
import { validateConfig, loadAndValidateConfig, parsePartialConfig } from "./validation.js";

describe("validateConfig", () => {
  it("returns ok with defaults merged for valid minimal input", () => {
    const result = validateConfig({});
    expect(result.ok).toBe(true);
    expect(result.config).toBeDefined();
    expect(result.config!.llm.brain).toBe("opus");
    expect(result.config!.channels.terminal.enabled).toBe(true);
  });

  it("returns errors for invalid input", () => {
    const result = validateConfig({ llm: { brain: "gpt-4" } });
    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors!.some((e) => e.includes("brain"))).toBe(true);
  });
});

describe("loadAndValidateConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns JinxConfig for valid file", async () => {
    vi.mocked(loadRawConfig).mockResolvedValue({});
    const config = await loadAndValidateConfig("/tmp/config.yaml");
    expect(config.llm.brain).toBe("opus");
    expect(loadRawConfig).toHaveBeenCalledWith("/tmp/config.yaml");
  });

  it("throws with error details for invalid file", async () => {
    vi.mocked(loadRawConfig).mockResolvedValue({ llm: { brain: "invalid-model" } });
    await expect(loadAndValidateConfig()).rejects.toThrow("Invalid config");
  });
});

describe("validateConfig – marathon", () => {
  it("marathon config has correct defaults when omitted", () => {
    const result = validateConfig({});
    expect(result.ok).toBe(true);
    expect(result.config!.marathon.enabled).toBe(true);
    expect(result.config!.marathon.maxConcurrent).toBe(1);
    expect(result.config!.marathon.chunkIntervalMs).toBe(5000);
    expect(result.config!.marathon.maxChunks).toBe(50);
    expect(result.config!.marathon.maxDurationHours).toBe(12);
    expect(result.config!.marathon.maxRetriesPerChunk).toBe(3);
    expect(result.config!.marathon.container.cpus).toBe(4);
    expect(result.config!.marathon.container.memoryGB).toBe(4);
    expect(result.config!.marathon.container.commandTimeoutMs).toBe(600_000);
    expect(result.config!.marathon.progress.notifyEveryNChunks).toBe(1);
    expect(result.config!.marathon.progress.includeFileSummary).toBe(true);
    expect(result.config!.marathon.control.allowFrom).toEqual([]);
    expect(result.config!.marathon.control.allowSameGroupMembers).toBe(false);
  });

  it("marathon config validates cpus as positive integer", () => {
    const result = validateConfig({ marathon: { container: { cpus: -1 } } });
    expect(result.ok).toBe(false);
    expect(result.errors!.some((e) => e.includes("cpus"))).toBe(true);
  });

  it("marathon config validates maxChunks as positive integer", () => {
    const result = validateConfig({ marathon: { maxChunks: 0 } });
    expect(result.ok).toBe(false);
    expect(result.errors!.some((e) => e.includes("maxChunks"))).toBe(true);
  });

  it("marathon config rejects negative maxDurationHours", () => {
    const result = validateConfig({ marathon: { maxDurationHours: -5 } });
    expect(result.ok).toBe(false);
    expect(result.errors!.some((e) => e.includes("maxDurationHours"))).toBe(true);
  });

  it("marathon control config accepts scoped controller settings", () => {
    const result = validateConfig({
      marathon: {
        control: {
          allowFrom: ["maintainer-1"],
          allowSameGroupMembers: true,
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.config!.marathon.control.allowFrom).toEqual(["maintainer-1"]);
    expect(result.config!.marathon.control.allowSameGroupMembers).toBe(true);
  });
});

describe("parsePartialConfig", () => {
  it("merges partial input with Zod defaults", () => {
    const config = parsePartialConfig({ llm: { brain: "haiku" } });
    expect(config.llm.brain).toBe("haiku");
    expect(config.llm.subagent).toBe("sonnet");
    expect(config.channels.terminal.enabled).toBe(true);
  });

  it("preserves whatsapp browserName field", () => {
    const config = parsePartialConfig({
      channels: { whatsapp: { enabled: true, browserName: "MyBot" } },
    });
    expect(config.channels.whatsapp.browserName).toBe("MyBot");
    expect(config.channels.whatsapp.enabled).toBe(true);
  });
});
