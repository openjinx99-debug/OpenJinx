import { spawn } from "node:child_process";
import type { ContainerSession, ExecResult, SandboxConfig } from "./types.js";
import { createLogger } from "../infra/logger.js";
import { buildMountList } from "./mount-security.js";
import { isAppleContainerReady, describeRuntime } from "./runtime-detect.js";

const logger = createLogger("container-manager");

/** POSIX single-quote escape: wraps in single quotes, escaping embedded quotes. */
function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Sweep interval for idle container eviction (60s). */
const SWEEP_INTERVAL_MS = 60_000;

/** Grace period after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 5_000;

/** Polling interval when waiting for container readiness. */
const READY_POLL_MS = 100;

/** Max time to wait for container readiness. */
const READY_TIMEOUT_MS = 30_000;

interface ManagedContainer extends ContainerSession {
  /** Shared promise for concurrent getOrCreate callers. */
  readyPromise: Promise<void> | null;
}

export interface ContainerManager {
  /** Get or start a container for the given session key. */
  getOrCreate(sessionKey: string, workspaceDir: string): Promise<ContainerSession>;
  /** Execute a command in the session's container. */
  exec(
    sessionKey: string,
    command: string,
    opts?: { timeoutMs?: number; workingDir?: string },
  ): Promise<ExecResult>;
  /** Stop and remove a specific session's container. */
  stop(sessionKey: string): Promise<void>;
  /** Stop all managed containers. */
  stopAll(): Promise<void>;
  /** Run one idle-sweep pass (exported for testing). */
  sweepIdle(): void;
  /** Tear down: clear sweep timer + stop all containers. */
  dispose(): Promise<void>;
}

/**
 * Create a container manager that maintains persistent Apple Container sessions.
 *
 * Containers are started lazily on first exec, kept alive for reuse, and
 * destroyed after `idleTimeoutMs` of inactivity. Workspace is mounted from
 * host so files survive container destruction.
 */
export function createContainerManager(config: SandboxConfig): ContainerManager {
  const containers = new Map<string, ManagedContainer>();
  let sweepTimer: ReturnType<typeof setInterval> | undefined;

  function startSweep(): void {
    if (sweepTimer) {
      return;
    }
    sweepTimer = setInterval(() => mgr.sweepIdle(), SWEEP_INTERVAL_MS);
    sweepTimer.unref();
  }

  function makeContainerId(sessionKey: string): string {
    // Sanitize session key for container name: replace non-alphanumeric with dashes
    const sanitized = sessionKey.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40);
    const suffix = crypto.randomUUID().slice(0, 8);
    return `jinx-${sanitized}-${suffix}`;
  }

  async function startContainer(
    sessionKey: string,
    workspaceDir: string,
  ): Promise<ManagedContainer> {
    if (!isAppleContainerReady()) {
      throw new Error(describeRuntime(false));
    }

    const containerId = makeContainerId(sessionKey);
    const mounts = buildMountList(workspaceDir, config);

    // Build container run args for persistent (detached) container
    const args = ["run", "-d", "--name", containerId];

    for (const mount of mounts) {
      const mountStr = mount.readOnly
        ? `type=bind,source=${mount.hostPath},target=${mount.containerPath},readonly`
        : `type=bind,source=${mount.hostPath},target=${mount.containerPath}`;
      args.push("--mount", mountStr);
    }

    args.push("-w", "/workspace");
    args.push(config.image, "sleep", "infinity");

    logger.info(`Starting container: ${containerId} for session=${sessionKey}`);
    logger.debug(`Args: container ${args.join(" ")}`);

    const now = Date.now();
    const managed: ManagedContainer = {
      containerId,
      sessionKey,
      status: "starting",
      startedAt: now,
      lastExecAt: now,
      readyPromise: null,
    };

    // Start the container
    managed.readyPromise = new Promise<void>((resolve, reject) => {
      const child = spawn("container", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
      });

      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          managed.status = "stopped";
          reject(new Error(`Container start failed (exit ${code}): ${stderr.trim()}`));
          return;
        }
        // Container started, now wait for readiness
        waitForReady(containerId)
          .then(() => {
            managed.status = "ready";
            managed.readyPromise = null;
            logger.info(`Container ready: ${containerId} (${Date.now() - now}ms)`);
            resolve();
          })
          .catch((err) => {
            managed.status = "stopped";
            // Best-effort cleanup
            spawn("container", ["rm", "-f", containerId], { stdio: "ignore" });
            reject(err);
          });
      });

      child.on("error", (err) => {
        managed.status = "stopped";
        reject(new Error(`Failed to spawn container process: ${err.message}`));
      });
    });

    containers.set(sessionKey, managed);
    startSweep();

    await managed.readyPromise;
    return managed;
  }

  /**
   * Poll `container exec {id} echo ready` until it succeeds.
   */
  async function waitForReady(containerId: string): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const ok = await new Promise<boolean>((resolve) => {
        const child = spawn("container", ["exec", containerId, "echo", "ready"], {
          stdio: ["ignore", "pipe", "pipe"],
          env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
        });
        child.on("close", (code) => resolve(code === 0));
        child.on("error", () => resolve(false));
      });

      if (ok) {
        return;
      }
      await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }

    throw new Error(`Container ${containerId} did not become ready within ${READY_TIMEOUT_MS}ms`);
  }

  async function execInContainer(
    containerId: string,
    command: string,
    opts?: { timeoutMs?: number; workingDir?: string },
  ): Promise<ExecResult> {
    const timeoutMs = opts?.timeoutMs ?? config.timeoutMs;
    const maxOutputBytes = config.maxOutputBytes;
    const workDir = opts?.workingDir ?? "/workspace";

    const args = ["exec", containerId, "sh", "-c", `cd ${shellQuote(workDir)} && ${command}`];

    const startMs = Date.now();

    return new Promise<ExecResult>((resolve) => {
      const child = spawn("container", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
      });

      let stdout = "";
      let stderr = "";
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let timedOut = false;
      let settled = false;

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdoutTruncated) {
          return;
        }
        stdout += chunk.toString();
        if (stdout.length > maxOutputBytes) {
          stdout = stdout.slice(0, maxOutputBytes) + "\n[... output truncated]";
          stdoutTruncated = true;
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (stderrTruncated) {
          return;
        }
        stderr += chunk.toString();
        if (stderr.length > maxOutputBytes) {
          stderr = stderr.slice(0, maxOutputBytes) + "\n[... output truncated]";
          stderrTruncated = true;
        }
      });

      const timer = setTimeout(() => {
        timedOut = true;
        logger.warn(`Exec timed out after ${timeoutMs}ms in container ${containerId}`);
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) {
            child.kill("SIGKILL");
          }
        }, KILL_GRACE_MS);
      }, timeoutMs);

      child.on("close", (code) => {
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - startMs,
        });
      });

      child.on("error", (err) => {
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: 1,
          stdout: "",
          stderr: `Failed to exec in container: ${err.message}`,
          timedOut: false,
          durationMs: Date.now() - startMs,
        });
      });
    });
  }

  async function isContainerAlive(containerId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const child = spawn("container", ["exec", containerId, "true"], {
        stdio: "ignore",
        env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
      });
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    });
  }

  async function removeContainer(containerId: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const child = spawn("container", ["stop", containerId], {
        stdio: "ignore",
        env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
      });
      child.on("close", () => {
        // Force remove after stop
        const rm = spawn("container", ["rm", "-f", containerId], {
          stdio: "ignore",
          env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
        });
        rm.on("close", () => resolve());
        rm.on("error", () => resolve());
      });
      child.on("error", () => resolve());
    });
  }

  async function cleanupOrphans(): Promise<void> {
    const child = spawn("container", ["ls", "--filter", "name=jinx-", "-q"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    });

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    await new Promise<void>((resolve) => {
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });

    const ids = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      return;
    }

    logger.info(`Cleaning up ${ids.length} orphaned jinx container(s)`);
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((resolve) => {
            const rm = spawn("container", ["rm", "-f", id], {
              stdio: "ignore",
              env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
            });
            rm.on("close", () => resolve());
            rm.on("error", () => resolve());
          }),
      ),
    );
  }

  // Fire-and-forget orphan cleanup — don't block startup
  cleanupOrphans().catch((err) => {
    logger.warn(`Orphan cleanup failed: ${err}`);
  });

  const mgr: ContainerManager = {
    async getOrCreate(sessionKey, workspaceDir) {
      const existing = containers.get(sessionKey);
      if (existing) {
        // If starting, wait for the shared ready promise
        if (existing.status === "starting" && existing.readyPromise) {
          await existing.readyPromise;
        }
        if (existing.status === "ready") {
          return existing;
        }
        // Stopped/stopping — remove stale entry and create fresh
        containers.delete(sessionKey);
      }
      return startContainer(sessionKey, workspaceDir);
    },

    async exec(sessionKey, command, opts) {
      const container = containers.get(sessionKey);
      if (!container || container.status !== "ready") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `No ready container for session: ${sessionKey}. Call getOrCreate first.`,
          timedOut: false,
          durationMs: 0,
        };
      }
      container.lastExecAt = Date.now();
      const result = await execInContainer(container.containerId, command, opts);

      // If exec failed, check if the container itself died
      if (result.exitCode !== 0) {
        const alive = await isContainerAlive(container.containerId);
        if (!alive) {
          logger.warn(`Container ${container.containerId} is dead, marking stopped`);
          container.status = "stopped";
          containers.delete(sessionKey);
        }
      }

      return result;
    },

    async stop(sessionKey) {
      const container = containers.get(sessionKey);
      if (!container || container.status === "stopping" || container.status === "stopped") {
        return;
      }

      container.status = "stopping";
      logger.info(`Stopping container: ${container.containerId}`);
      await removeContainer(container.containerId);
      container.status = "stopped";
      containers.delete(sessionKey);
    },

    async stopAll() {
      const keys = [...containers.keys()];
      await Promise.all(keys.map((key) => mgr.stop(key)));
    },

    sweepIdle() {
      const now = Date.now();
      for (const [key, container] of containers) {
        if (container.status === "ready" && now - container.lastExecAt > config.idleTimeoutMs) {
          logger.info(`Idle sweep: destroying container ${container.containerId} (session=${key})`);
          mgr.stop(key).catch((err) => {
            logger.warn(`Failed to stop idle container ${container.containerId}: ${err}`);
          });
        }
      }
    },

    async dispose() {
      if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = undefined;
      }
      await mgr.stopAll();
    },
  };

  return mgr;
}
