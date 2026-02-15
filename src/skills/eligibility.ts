import { execFileSync } from "node:child_process";
import type { ParsedSkillFrontmatter } from "./parser.js";
import { isValidBinaryName } from "../infra/security.js";

/**
 * Check if a skill is eligible to run on the current system.
 * Checks OS, required binaries, and required env vars.
 */
export function checkSkillEligibility(frontmatter: ParsedSkillFrontmatter): boolean {
  // Check OS
  if (frontmatter.os && frontmatter.os.length > 0) {
    const currentOs = process.platform === "darwin" ? "macos" : process.platform;
    if (!frontmatter.os.includes(currentOs)) {
      return false;
    }
  }

  // Check required binaries
  if (frontmatter.requiredBins) {
    for (const bin of frontmatter.requiredBins) {
      if (!isBinaryAvailable(bin)) {
        return false;
      }
    }
  }

  // Check required env vars
  if (frontmatter.requiredEnvVars) {
    for (const envVar of frontmatter.requiredEnvVars) {
      if (!process.env[envVar]) {
        return false;
      }
    }
  }

  return true;
}

export interface EligibilityResult {
  eligible: boolean;
  missingBins: string[];
  missingEnvVars: string[];
  wrongOs: boolean;
}

/**
 * Get detailed eligibility information for a skill.
 * Returns which specific requirements are not met.
 */
export function getEligibilityReasons(frontmatter: ParsedSkillFrontmatter): EligibilityResult {
  const result: EligibilityResult = {
    eligible: true,
    missingBins: [],
    missingEnvVars: [],
    wrongOs: false,
  };

  // Check OS
  if (frontmatter.os && frontmatter.os.length > 0) {
    const currentOs = process.platform === "darwin" ? "macos" : process.platform;
    if (!frontmatter.os.includes(currentOs)) {
      result.wrongOs = true;
      result.eligible = false;
    }
  }

  // Check required binaries
  if (frontmatter.requiredBins) {
    for (const bin of frontmatter.requiredBins) {
      if (!isBinaryAvailable(bin)) {
        result.missingBins.push(bin);
        result.eligible = false;
      }
    }
  }

  // Check required env vars
  if (frontmatter.requiredEnvVars) {
    for (const envVar of frontmatter.requiredEnvVars) {
      if (!process.env[envVar]) {
        result.missingEnvVars.push(envVar);
        result.eligible = false;
      }
    }
  }

  return result;
}

function isBinaryAvailable(name: string): boolean {
  if (!isValidBinaryName(name)) {
    return false;
  }
  try {
    execFileSync("/bin/sh", ["-c", 'command -v "$1"', "--", name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
