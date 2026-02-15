import type { AgentToolDefinition } from "../../providers/types.js";
import type { ContainerManager } from "../../sandbox/container-manager.js";
import type { SandboxConfig } from "../../sandbox/types.js";

export interface ExecToolContext {
  /** Agent workspace directory to mount. */
  workspaceDir: string;
  /** Sandbox configuration. */
  sandboxConfig: SandboxConfig;
  /** Session key for persistent container lifecycle. */
  sessionKey: string;
  /** Container manager for persistent sessions. */
  containerManager: ContainerManager;
}

export function getExecToolDefinitions(ctx: ExecToolContext): AgentToolDefinition[] {
  return [
    {
      name: "exec",
      description:
        "Execute a shell command inside a sandboxed container. The agent's workspace is mounted at /workspace. Installed packages and file changes persist across calls within the same session. Use this for running scripts, build commands, tests, or system commands.",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute.",
          },
          working_dir: {
            type: "string",
            description: "Working directory inside the container (default: /workspace).",
          },
          timeout_ms: {
            type: "number",
            description: "Command timeout in milliseconds (overrides default).",
          },
        },
        required: ["command"],
      },
      execute: async (input) => {
        const { command, working_dir, timeout_ms } = input as {
          command: string;
          working_dir?: string;
          timeout_ms?: number;
        };

        if (!command || !command.trim()) {
          return { error: "Command cannot be empty." };
        }

        // Ensure container is running for this session
        await ctx.containerManager.getOrCreate(ctx.sessionKey, ctx.workspaceDir);

        const result = await ctx.containerManager.exec(ctx.sessionKey, command, {
          timeoutMs: timeout_ms,
          workingDir: working_dir,
        });

        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
        };
      },
    },
  ];
}
