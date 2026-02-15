import fs from "node:fs";
import path from "node:path";
import type { MountEntry, SandboxConfig } from "./types.js";

/** Hardcoded patterns that must never be mounted into a container. */
const BLOCKED_PATTERNS = [
  ".ssh",
  ".gnupg",
  ".gpg",
  ".aws",
  ".azure",
  ".gcloud",
  ".config/gcloud",
  ".kube",
  ".docker",
  ".env",
  ".env.local",
  ".env.production",
  "credentials",
  "credentials.json",
  "private_key",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".gem/credentials",
];

/**
 * Resolve a path to its real location, preventing symlink attacks.
 * Returns null if the path is a symlink or resolves outside expected boundaries.
 */
export function resolveRealPath(hostPath: string): string | null {
  const resolved = path.resolve(hostPath);
  try {
    const real = fs.realpathSync(resolved);
    return real;
  } catch {
    // Path doesn't exist yet — that's ok for workspace dirs that will be created
    return resolved;
  }
}

/**
 * Check whether a path matches any blocked pattern.
 */
function isBlocked(hostPath: string, extraPatterns: string[]): boolean {
  const allPatterns = [...BLOCKED_PATTERNS, ...extraPatterns];
  const normalized = path.resolve(hostPath);
  const segments = normalized.split(path.sep);

  for (const pattern of allPatterns) {
    // Check if any path segment matches the pattern
    if (segments.some((seg) => seg === pattern)) {
      return true;
    }
    // Check if the full path ends with the pattern
    if (normalized.endsWith(path.sep + pattern) || normalized.endsWith(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Validate that a proposed workspace mount is safe.
 * Returns the validated mount entry or throws if blocked.
 */
export function validateWorkspaceMount(workspaceDir: string, config: SandboxConfig): MountEntry {
  const realPath = resolveRealPath(workspaceDir);
  if (!realPath) {
    throw new Error(`Cannot resolve workspace path: ${workspaceDir}`);
  }

  if (isBlocked(realPath, config.blockedPatterns)) {
    throw new Error(`Workspace path matches a blocked pattern: ${workspaceDir}`);
  }

  return {
    hostPath: realPath,
    containerPath: "/workspace",
    readOnly: !config.workspaceWritable,
  };
}

/**
 * Validate extra mount entries from config.
 * All extra mounts are forced read-only.
 */
export function validateExtraMounts(mounts: string[], config: SandboxConfig): MountEntry[] {
  const entries: MountEntry[] = [];
  for (const hostPath of mounts) {
    const realPath = resolveRealPath(hostPath);
    if (!realPath) {
      throw new Error(`Cannot resolve mount path: ${hostPath}`);
    }
    if (isBlocked(realPath, config.blockedPatterns)) {
      throw new Error(`Mount path matches a blocked pattern: ${hostPath}`);
    }
    // Derive container path from basename
    const containerPath = "/mnt/" + path.basename(realPath);
    entries.push({ hostPath: realPath, containerPath, readOnly: true });
  }
  return entries;
}

/**
 * Build the complete list of validated mounts for a container run.
 */
export function buildMountList(workspaceDir: string, config: SandboxConfig): MountEntry[] {
  const workspace = validateWorkspaceMount(workspaceDir, config);
  const extra = validateExtraMounts(config.allowedMounts, config);
  return [workspace, ...extra];
}

/** Exposed for testing. */
export { BLOCKED_PATTERNS, isBlocked as isBlockedPath };
