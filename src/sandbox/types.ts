/** Result of executing a command in a container. */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/** Container runtime backend. */
export type ContainerRuntime = "apple-container";

/** Configuration for the sandbox subsystem. */
export interface SandboxConfig {
  enabled: boolean;
  /** Default command timeout in milliseconds. */
  timeoutMs: number;
  /** Idle timeout before destroying a persistent container (ms). */
  idleTimeoutMs: number;
  /** Max output bytes per stream (stdout/stderr). */
  maxOutputBytes: number;
  /** Container image to use. */
  image: string;
  /** Additional glob patterns to block from mounting. */
  blockedPatterns: string[];
  /** Extra host directories to mount read-only. */
  allowedMounts: string[];
  /** Whether the workspace is mounted read-write (vs read-only). */
  workspaceWritable: boolean;
}

/** Status of a managed container session. */
export type ContainerStatus = "starting" | "ready" | "stopping" | "stopped";

/** Tracks a persistent container session. */
export interface ContainerSession {
  containerId: string;
  sessionKey: string;
  status: ContainerStatus;
  startedAt: number;
  lastExecAt: number;
}

/** A mount entry for the container. */
export interface MountEntry {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

/** Options for running a command in the sandbox. */
export interface SandboxExecOptions {
  command: string;
  workingDir?: string;
  timeoutMs?: number;
  workspaceDir: string;
  config: SandboxConfig;
}
