import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../infra/home-dir.js", () => ({
  resolveHomeDir: vi.fn(() => "/tmp/.jinx"),
  ensureHomeDir: vi.fn(),
}));

vi.mock("../../workspace/bootstrap.js", () => ({
  ensureWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../providers/auth.js", () => ({
  resolveAuth: vi.fn(() => ({ mode: "oauth", token: "oauth-test-token" })),
}));

describe("onboardCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("bootstraps config/workspace and reports detected auth", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

    const { onboardCommand } = await import("./onboard.js");
    const { ensureHomeDir } = await import("../../infra/home-dir.js");
    const { ensureWorkspace } = await import("../../workspace/bootstrap.js");

    await onboardCommand.parseAsync([], { from: "user" });

    expect(ensureHomeDir).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/.jinx/config.yaml",
      expect.any(String),
      "utf-8",
    );
    expect(ensureWorkspace).toHaveBeenCalledWith("/tmp/.jinx/workspace");

    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("Bootstrapping Jinx...");
    expect(output).toContain("Created config: /tmp/.jinx/config.yaml");
    expect(output).toContain("Claude auth: OAuth token found");
    expect(output).toContain("Bootstrap complete!");
  });

  it("keeps existing config and prints auth remediation when missing", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

    const { resolveAuth } = await import("../../providers/auth.js");
    vi.mocked(resolveAuth).mockImplementation(() => {
      throw new Error("No auth");
    });

    const { onboardCommand } = await import("./onboard.js");
    await onboardCommand.parseAsync([], { from: "user" });

    expect(fs.writeFileSync).not.toHaveBeenCalled();

    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("Config already exists: /tmp/.jinx/config.yaml");
    expect(output).toContain("No Claude auth found.");
    expect(output).toContain("~/.jinx/.env");
    expect(output).toContain("claude login");
  });
});
