import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SandboxConfig } from "../types.js";
import { createContainerManager, type ContainerManager } from "../container-manager.js";
import { isAppleContainerReady } from "../runtime-detect.js";

/**
 * Integration tests for ContainerManager using real Apple Containers.
 * Skipped when Apple Container runtime is not available (e.g. CI, non-macOS).
 */
const canRun = isAppleContainerReady();

describe.skipIf(!canRun)("container-manager integration", () => {
  let mgr: ContainerManager;

  const config: SandboxConfig = {
    enabled: true,
    timeoutMs: 30_000,
    idleTimeoutMs: 300_000,
    maxOutputBytes: 102_400,
    image: "ghcr.io/macoscontainers/macos-base:latest",
    blockedPatterns: [],
    allowedMounts: [],
    workspaceWritable: true,
  };

  beforeAll(() => {
    mgr = createContainerManager(config);
  });

  afterAll(async () => {
    await mgr.dispose();
  });

  it("starts a container and executes a command", async () => {
    const session = await mgr.getOrCreate("integ-exec", "/tmp");
    expect(session.status).toBe("ready");
    expect(session.containerId).toMatch(/^jinx-integ-exec-/);

    const result = await mgr.exec("integ-exec", "echo hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.timedOut).toBe(false);
  }, 60_000);

  it("preserves state between execs", async () => {
    await mgr.getOrCreate("integ-state", "/tmp");

    await mgr.exec("integ-state", "touch /tmp/testfile");
    const result = await mgr.exec("integ-state", "ls /tmp/testfile");

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("/tmp/testfile");
  }, 60_000);

  it("stops and cleans up container", async () => {
    const session = await mgr.getOrCreate("integ-cleanup", "/tmp");
    const containerId = session.containerId;

    await mgr.stop("integ-cleanup");

    // Exec on stopped session should return error
    const result = await mgr.exec("integ-cleanup", "echo hi");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No ready container");

    // Verify the container is actually gone (container exec should fail)
    const { spawn } = await import("node:child_process");
    const alive = await new Promise<boolean>((resolve) => {
      const child = spawn("container", ["exec", containerId, "true"], { stdio: "ignore" });
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    });
    expect(alive).toBe(false);
  }, 60_000);
});
