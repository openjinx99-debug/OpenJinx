import { execFile } from "node:child_process";
import type { AgentToolDefinition } from "../../providers/types.js";

export interface HostExecToolContext {
  /** Command timeout in milliseconds. */
  timeoutMs: number;
  /** Maximum output bytes. */
  maxOutputBytes: number;
}

/** Patterns matching catastrophically destructive commands. */
const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+)*(-[a-zA-Z]*r[a-zA-Z]*\s+|--recursive\s+)*\//, // rm -rf /
  /mkfs/, // format filesystem
  /dd\s+.*\s+of=\/dev\//, // dd to block device
  /:\(\)\{\s*:\|:&\s*\}\s*;\s*:/, // fork bomb
  />\s*\/dev\/[sh]d/, // overwrite disk
  /chmod\s+(-[a-zA-Z]*\s+)*777\s+\//, // chmod 777 /
  /chown\s+.*\s+\//, // chown /
];

function isBlockedCommand(command: string): string | null {
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return `Blocked: command matches destructive pattern (${pattern.source.slice(0, 30)}...)`;
    }
  }
  return null;
}

export function getHostExecToolDefinitions(ctx: HostExecToolContext): AgentToolDefinition[] {
  return [
    {
      name: "exec",
      description:
        "Execute a shell command directly on the host machine. Use this for running scripts, managing processes, restarting services, and system administration tasks.",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute.",
          },
          working_dir: {
            type: "string",
            description: "Working directory (default: user home).",
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

        const blocked = isBlockedCommand(command);
        if (blocked) {
          return { error: blocked };
        }

        const timeout = timeout_ms ?? ctx.timeoutMs;
        const start = Date.now();

        return new Promise((resolve) => {
          const proc = execFile(
            "/bin/sh",
            ["-c", command],
            {
              cwd: working_dir ?? process.env.HOME,
              timeout,
              maxBuffer: ctx.maxOutputBytes,
              env: { ...process.env },
            },
            (error, stdout, stderr) => {
              const durationMs = Date.now() - start;
              const timedOut = error?.killed === true;
              const exitCode = timedOut ? -1 : ((error?.code as number | undefined) ?? 0);

              resolve({
                exitCode,
                stdout: stdout.slice(0, ctx.maxOutputBytes),
                stderr: stderr.slice(0, ctx.maxOutputBytes),
                timedOut,
                durationMs,
              });
            },
          );

          proc.on("error", (err) => {
            resolve({
              exitCode: -1,
              stdout: "",
              stderr: String(err),
              timedOut: false,
              durationMs: Date.now() - start,
            });
          });
        });
      },
    },
  ];
}
