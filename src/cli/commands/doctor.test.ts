import fs from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config/loader.js", () => ({
  resolveConfigPath: vi.fn(() => "/tmp/.jinx/config.yaml"),
}));

vi.mock("../../infra/home-dir.js", () => ({
  resolveHomeDir: vi.fn(() => "/tmp/.jinx"),
}));

vi.mock("../../providers/auth.js", () => ({
  hasAuth: vi.fn(() => true),
}));

describe("doctorCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("runs checks and reports results", async () => {
    // Mock filesystem checks
    vi.spyOn(fs, "existsSync").mockReturnValue(true);

    const { doctorCommand } = await import("./doctor.js");

    // Reset exitCode before running
    process.exitCode = undefined;
    await doctorCommand.parseAsync([], { from: "user" });

    const logCalls = vi.mocked(console.log).mock.calls.flat();
    const output = logCalls.join("\n");

    expect(output).toContain("Home directory");
    expect(output).toContain("Config file");
    expect(output).toContain("Workspace");
    expect(output).toContain("Claude auth");
    expect(output).toContain("Node.js");
    expect(output).toContain("All checks passed!");
    expect(process.exitCode).toBe(0);
  });

  it("reports failures when checks fail", async () => {
    // Some paths don't exist
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const { doctorCommand } = await import("./doctor.js");

    process.exitCode = undefined;
    await doctorCommand.parseAsync([], { from: "user" });

    const logCalls = vi.mocked(console.log).mock.calls.flat();
    const output = logCalls.join("\n");

    expect(output).toContain("[FAIL]");
    expect(output).toContain("Some checks failed");
    expect(process.exitCode).toBe(1);
  });
});
