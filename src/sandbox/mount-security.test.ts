import { describe, expect, it } from "vitest";
import type { SandboxConfig } from "./types.js";
import {
  BLOCKED_PATTERNS,
  buildMountList,
  isBlockedPath,
  validateExtraMounts,
  validateWorkspaceMount,
} from "./mount-security.js";

const baseConfig: SandboxConfig = {
  enabled: true,
  timeoutMs: 300_000,
  idleTimeoutMs: 900_000,
  maxOutputBytes: 102_400,
  image: "node:22-slim",
  blockedPatterns: [],
  allowedMounts: [],
  workspaceWritable: true,
};

describe("mount-security", () => {
  describe("BLOCKED_PATTERNS", () => {
    it("blocks .ssh directory", () => {
      expect(BLOCKED_PATTERNS).toContain(".ssh");
    });

    it("blocks .gnupg directory", () => {
      expect(BLOCKED_PATTERNS).toContain(".gnupg");
    });

    it("blocks .aws directory", () => {
      expect(BLOCKED_PATTERNS).toContain(".aws");
    });

    it("blocks .env files", () => {
      expect(BLOCKED_PATTERNS).toContain(".env");
      expect(BLOCKED_PATTERNS).toContain(".env.local");
    });

    it("blocks credentials files", () => {
      expect(BLOCKED_PATTERNS).toContain("credentials");
      expect(BLOCKED_PATTERNS).toContain("credentials.json");
    });

    it("blocks private key files", () => {
      expect(BLOCKED_PATTERNS).toContain("id_rsa");
      expect(BLOCKED_PATTERNS).toContain("id_ed25519");
    });
  });

  describe("isBlockedPath", () => {
    it("blocks paths containing .ssh", () => {
      expect(isBlockedPath("/home/user/.ssh", [])).toBe(true);
    });

    it("blocks paths containing .env", () => {
      expect(isBlockedPath("/project/.env", [])).toBe(true);
    });

    it("allows normal workspace paths", () => {
      expect(isBlockedPath("/home/user/workspace", [])).toBe(false);
    });

    it("allows normal project paths", () => {
      expect(isBlockedPath("/home/user/projects/myapp", [])).toBe(false);
    });

    it("blocks custom patterns", () => {
      expect(isBlockedPath("/home/user/.secret", [".secret"])).toBe(true);
    });

    it("does not block similar but non-matching paths", () => {
      expect(isBlockedPath("/home/user/ssh-keys-docs", [])).toBe(false);
    });
  });

  describe("validateWorkspaceMount", () => {
    it("creates a valid mount entry for workspace", () => {
      const mount = validateWorkspaceMount("/tmp/test-workspace", baseConfig);
      expect(mount.containerPath).toBe("/workspace");
      expect(mount.readOnly).toBe(false);
    });

    it("creates read-only mount when workspaceWritable is false", () => {
      const mount = validateWorkspaceMount("/tmp/test-workspace", {
        ...baseConfig,
        workspaceWritable: false,
      });
      expect(mount.readOnly).toBe(true);
    });

    it("throws for blocked workspace path", () => {
      expect(() => validateWorkspaceMount("/home/user/.ssh", baseConfig)).toThrow(
        "blocked pattern",
      );
    });
  });

  describe("validateExtraMounts", () => {
    it("creates read-only mount entries", () => {
      const mounts = validateExtraMounts(["/tmp/extra"], baseConfig);
      expect(mounts).toHaveLength(1);
      expect(mounts[0].readOnly).toBe(true);
      expect(mounts[0].containerPath).toBe("/mnt/extra");
    });

    it("throws for blocked extra mount", () => {
      expect(() => validateExtraMounts(["/home/user/.aws"], baseConfig)).toThrow("blocked pattern");
    });

    it("handles multiple extra mounts", () => {
      const mounts = validateExtraMounts(["/tmp/data1", "/tmp/data2"], baseConfig);
      expect(mounts).toHaveLength(2);
    });
  });

  describe("buildMountList", () => {
    it("includes workspace + extra mounts", () => {
      const config = { ...baseConfig, allowedMounts: ["/tmp/extra"] };
      const mounts = buildMountList("/tmp/workspace", config);
      expect(mounts).toHaveLength(2);
      expect(mounts[0].containerPath).toBe("/workspace");
      expect(mounts[1].containerPath).toBe("/mnt/extra");
    });

    it("returns only workspace mount when no extras", () => {
      const mounts = buildMountList("/tmp/workspace", baseConfig);
      expect(mounts).toHaveLength(1);
      expect(mounts[0].containerPath).toBe("/workspace");
    });
  });
});
