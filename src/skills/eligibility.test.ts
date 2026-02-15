import { execFileSync } from "node:child_process";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { ParsedSkillFrontmatter } from "./parser.js";
import { checkSkillEligibility, getEligibilityReasons } from "./eligibility.js";

// Mock child_process to control binary availability
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe("checkSkillEligibility", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all binaries are available
    mockedExecFileSync.mockReturnValue(Buffer.from(""));
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env = { ...originalEnv };
  });

  it("returns true when no restrictions are specified", () => {
    const frontmatter: ParsedSkillFrontmatter = {};
    expect(checkSkillEligibility(frontmatter)).toBe(true);
  });

  it("returns true when current OS matches", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const frontmatter: ParsedSkillFrontmatter = { os: ["macos"] };
    expect(checkSkillEligibility(frontmatter)).toBe(true);
  });

  it("returns false when current OS does not match", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const frontmatter: ParsedSkillFrontmatter = { os: ["linux"] };
    expect(checkSkillEligibility(frontmatter)).toBe(false);
  });

  it("returns true when required binaries are available", () => {
    mockedExecFileSync.mockReturnValue(Buffer.from("/usr/bin/git\n"));
    const frontmatter: ParsedSkillFrontmatter = { requiredBins: ["git"] };
    expect(checkSkillEligibility(frontmatter)).toBe(true);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", 'command -v "$1"', "--", "git"],
      { stdio: "ignore" },
    );
  });

  it("returns false when a required binary is not available", () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const binName = Array.isArray(args) ? args[args.length - 1] : "";
      if (binName === "nonexistent") {
        throw new Error("not found");
      }
      return Buffer.from("");
    });

    const frontmatter: ParsedSkillFrontmatter = {
      requiredBins: ["git", "nonexistent"],
    };
    expect(checkSkillEligibility(frontmatter)).toBe(false);
  });

  it("returns true when required env vars are set", () => {
    process.env["MY_API_KEY"] = "secret-value";
    const frontmatter: ParsedSkillFrontmatter = {
      requiredEnvVars: ["MY_API_KEY"],
    };
    expect(checkSkillEligibility(frontmatter)).toBe(true);
  });

  it("returns false when a required env var is missing", () => {
    delete process.env["MISSING_VAR"];
    const frontmatter: ParsedSkillFrontmatter = {
      requiredEnvVars: ["MISSING_VAR"],
    };
    expect(checkSkillEligibility(frontmatter)).toBe(false);
  });

  it("checks all conditions: OS, binaries, and env vars", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env["REQUIRED_VAR"] = "present";
    mockedExecFileSync.mockReturnValue(Buffer.from(""));

    const frontmatter: ParsedSkillFrontmatter = {
      os: ["macos"],
      requiredBins: ["node"],
      requiredEnvVars: ["REQUIRED_VAR"],
    };
    expect(checkSkillEligibility(frontmatter)).toBe(true);
  });

  it("treats empty os array as no restriction", () => {
    const frontmatter: ParsedSkillFrontmatter = { os: [] };
    expect(checkSkillEligibility(frontmatter)).toBe(true);
  });

  it("rejects invalid binary names with shell metacharacters", () => {
    const frontmatter: ParsedSkillFrontmatter = {
      requiredBins: ["; rm -rf /"],
    };
    expect(checkSkillEligibility(frontmatter)).toBe(false);
    // execFileSync should NOT be called for invalid names
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("rejects binary names with command substitution", () => {
    const frontmatter: ParsedSkillFrontmatter = {
      requiredBins: ["$(whoami)"],
    };
    expect(checkSkillEligibility(frontmatter)).toBe(false);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});

describe("getEligibilityReasons", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedExecFileSync.mockReturnValue(Buffer.from(""));
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env = { ...originalEnv };
  });

  it("returns eligible with empty arrays when all requirements met", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env["REQUIRED_VAR"] = "present";
    mockedExecFileSync.mockReturnValue(Buffer.from("/usr/bin/git\n"));

    const result = getEligibilityReasons({
      os: ["macos"],
      requiredBins: ["git"],
      requiredEnvVars: ["REQUIRED_VAR"],
    });

    expect(result.eligible).toBe(true);
    expect(result.missingBins).toEqual([]);
    expect(result.missingEnvVars).toEqual([]);
    expect(result.wrongOs).toBe(false);
  });

  it("reports missing binaries by name", () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const binName = Array.isArray(args) ? args[args.length - 1] : "";
      if (binName === "memo") {
        throw new Error("not found");
      }
      return Buffer.from("");
    });

    const result = getEligibilityReasons({
      requiredBins: ["git", "memo"],
    });

    expect(result.eligible).toBe(false);
    expect(result.missingBins).toEqual(["memo"]);
  });

  it("reports missing env vars by name", () => {
    delete process.env["SECRET_KEY"];
    delete process.env["OTHER_KEY"];
    process.env["PRESENT_KEY"] = "value";

    const result = getEligibilityReasons({
      requiredEnvVars: ["PRESENT_KEY", "SECRET_KEY", "OTHER_KEY"],
    });

    expect(result.eligible).toBe(false);
    expect(result.missingEnvVars).toEqual(["SECRET_KEY", "OTHER_KEY"]);
  });

  it("reports wrong OS", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });

    const result = getEligibilityReasons({
      os: ["linux"],
    });

    expect(result.eligible).toBe(false);
    expect(result.wrongOs).toBe(true);
  });

  it("reports multiple issues simultaneously", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    delete process.env["MISSING_VAR"];
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const binName = Array.isArray(args) ? args[args.length - 1] : "";
      if (binName === "missing-bin") {
        throw new Error("not found");
      }
      return Buffer.from("");
    });

    const result = getEligibilityReasons({
      os: ["linux"],
      requiredBins: ["missing-bin"],
      requiredEnvVars: ["MISSING_VAR"],
    });

    expect(result.eligible).toBe(false);
    expect(result.wrongOs).toBe(true);
    expect(result.missingBins).toEqual(["missing-bin"]);
    expect(result.missingEnvVars).toEqual(["MISSING_VAR"]);
  });
});
