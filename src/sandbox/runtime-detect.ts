import { execFileSync } from "node:child_process";
import os from "node:os";

let _cachedResult: boolean | undefined;

/**
 * Check if Apple Container framework is available AND the system service is running.
 * Available on macOS 26+ (Tahoe) with the `container` CLI.
 *
 * We run `container list` rather than just `container --version` because
 * the CLI binary can exist without the system service being started
 * (`container system start`). `container list` requires the service.
 *
 * Result is cached after the first call to avoid blocking the event loop.
 */
export function isAppleContainerReady(): boolean {
  if (_cachedResult !== undefined) {
    return _cachedResult;
  }
  if (os.platform() !== "darwin") {
    _cachedResult = false;
    return false;
  }
  try {
    // `container list` fails with a descriptive XPC error if the
    // system service hasn't been started via `container system start`.
    execFileSync("container", ["list"], { stdio: "pipe", timeout: 5000 });
    _cachedResult = true;
    return true;
  } catch {
    _cachedResult = false;
    return false;
  }
}

/** Reset cache — for testing only. */
export function _resetRuntimeCache(): void {
  _cachedResult = undefined;
}

/**
 * Get a human-readable description of the runtime status.
 */
export function describeRuntime(available: boolean): string {
  if (!available) {
    return (
      "Apple Container not ready. Requires macOS 26+ (Tahoe) with the `container` CLI " +
      "and the system service running (`container system start`)."
    );
  }
  return "Using Apple Container (macOS native)";
}
