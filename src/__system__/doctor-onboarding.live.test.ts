/**
 * Live system test: doctor onboarding readiness mode.
 *
 * Verifies that `doctor --onboarding` runs with real provider/network checks
 * and surfaces setup-state blockers with actionable output.
 *
 * Run: pnpm test:live
 *
 * Prerequisites:
 *   - Claude auth available via Keychain OAuth, CLAUDE_CODE_OAUTH_TOKEN, or ANTHROPIC_API_KEY
 *
 * This test makes a real Anthropic API request.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface EnvSnapshot {
  JINX_HOME?: string;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
}

describe("doctor onboarding readiness (live)", () => {
  let tmpHome = "";
  let snapshot: EnvSnapshot;

  beforeEach(async () => {
    snapshot = {
      JINX_HOME: process.env.JINX_HOME,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    };

    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "jinx-doctor-live-"));
    process.env.JINX_HOME = tmpHome;

    // Force a deterministic live auth path without requiring real credentials.
    process.env.ANTHROPIC_API_KEY = "sk-ant-live-invalid";
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    // Keep the live check focused on Claude auth.
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    await fs.mkdir(path.join(tmpHome, "workspace"), { recursive: true });
    await fs.writeFile(
      path.join(tmpHome, "config.yaml"),
      [
        "channels:",
        "  terminal:",
        "    enabled: true",
        "  telegram:",
        "    enabled: false",
        "  whatsapp:",
        "    enabled: false",
        "composio:",
        "  enabled: false",
        "",
      ].join("\n"),
      "utf-8",
    );

    await fs.writeFile(
      path.join(tmpHome, "setup-state.json"),
      `${JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          assistantName: "Jinx",
          blockedReason: "live test blocker",
          steps: {
            prerequisites: "completed",
            dependencies: "completed",
            assistantName: "completed",
            apiKeys: "blocked",
            bootstrap: "pending",
            whatsapp: "skipped",
            telegram: "skipped",
            sandbox: "skipped",
            verify: "pending",
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
  });

  afterEach(async () => {
    process.env.JINX_HOME = snapshot.JINX_HOME;
    process.env.ANTHROPIC_API_KEY = snapshot.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = snapshot.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.OPENAI_API_KEY = snapshot.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = snapshot.OPENROUTER_API_KEY;

    process.exitCode = undefined;
    vi.restoreAllMocks();

    if (tmpHome) {
      await fs.rm(tmpHome, { recursive: true, force: true });
    }
  });

  it("runs live checks and reports onboarding blockers", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { doctorCommand } = await import("../cli/commands/doctor.js");
    process.exitCode = undefined;
    await doctorCommand.parseAsync(["node", "doctor", "--onboarding"]);

    const output = vi.mocked(console.log).mock.calls.flat().join("\n");

    expect(output).toContain("Jinx Doctor - Onboarding Readiness Check");
    expect(output).toContain("API Keys (live validation):");
    expect(output).toContain("Claude auth");
    expect(output.includes("401 Unauthorized") || output.includes("Connection error:")).toBe(true);
    expect(output).toContain("Onboarding State:");
    expect(output).toContain("Setup state: live test blocker");
    expect(output).toContain("Onboarding readiness:");
    expect(output).toContain("Recommended fixes:");
    expect(process.exitCode).toBe(1);
  });
});
