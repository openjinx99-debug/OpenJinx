import fs from "node:fs/promises";
import path from "node:path";
import type { AgentToolDefinition } from "../providers/types.js";
import type { ContainerManager } from "../sandbox/container-manager.js";
import type { MarathonTestFixConfig, JinxConfig } from "../types/config.js";
import type {
  TestFixResult,
  CriterionResult,
  CriteriaVerificationResult,
} from "../types/marathon.js";
import type { SessionStore } from "../types/sessions.js";
import { runAgent } from "../agents/runner.js";
import { createLogger } from "../infra/logger.js";
import { withTimeout } from "../infra/timeout.js";
import { resolveTranscriptPath } from "../sessions/transcript.js";
import { buildTestFixPrompt } from "./marathon-prompts.js";

const logger = createLogger("marathon-test-loop");

// ── Test Detection ───────────────────────────────────────────────────

export interface TestDetectionResult {
  command: string;
  /** Package manager detected (for Node.js projects). */
  packageManager?: "npm" | "yarn" | "pnpm" | "bun";
}

/**
 * Detect the test command for a project by inspecting its config files.
 * Priority: Node.js → Python → Rust → Go → Makefile.
 * Returns undefined if no test command can be determined.
 */
export async function detectTestCommand(
  workspaceDir: string,
): Promise<TestDetectionResult | undefined> {
  // 1. Node.js: package.json → scripts.test
  const nodeResult = await detectNodeTest(workspaceDir);
  if (nodeResult) {
    return nodeResult;
  }

  // 2. Python: pyproject.toml or requirements.txt → pytest
  if (await fileExists(path.join(workspaceDir, "pyproject.toml"))) {
    return { command: "cd /workspace && python -m pytest" };
  }
  if (await fileExists(path.join(workspaceDir, "requirements.txt"))) {
    const hasTestDir =
      (await fileExists(path.join(workspaceDir, "tests"))) ||
      (await fileExists(path.join(workspaceDir, "test")));
    if (hasTestDir) {
      return { command: "cd /workspace && python -m pytest" };
    }
  }

  // 3. Rust: Cargo.toml → cargo test
  if (await fileExists(path.join(workspaceDir, "Cargo.toml"))) {
    return { command: "cd /workspace && cargo test" };
  }

  // 4. Go: go.mod → go test ./...
  if (await fileExists(path.join(workspaceDir, "go.mod"))) {
    return { command: "cd /workspace && go test ./..." };
  }

  // 5. Makefile: has test target
  const makeResult = await detectMakeTest(workspaceDir);
  if (makeResult) {
    return makeResult;
  }

  return undefined;
}

async function detectNodeTest(workspaceDir: string): Promise<TestDetectionResult | undefined> {
  const pkgPath = path.join(workspaceDir, "package.json");
  try {
    const raw = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (!scripts?.test) {
      return undefined;
    }

    // Skip the default "no test" stub from `npm init`
    if (scripts.test.includes('echo "Error: no test specified"') || scripts.test === "exit 1") {
      return undefined;
    }

    // Detect package manager from lockfile
    const pm = await detectPackageManager(workspaceDir);
    const prefix = pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : pm === "bun" ? "bun" : "npm";
    return { command: `cd /workspace && ${prefix} test`, packageManager: pm };
  } catch {
    return undefined;
  }
}

async function detectPackageManager(
  workspaceDir: string,
): Promise<"npm" | "yarn" | "pnpm" | "bun"> {
  if (await fileExists(path.join(workspaceDir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await fileExists(path.join(workspaceDir, "yarn.lock"))) {
    return "yarn";
  }
  if (await fileExists(path.join(workspaceDir, "bun.lockb"))) {
    return "bun";
  }
  return "npm";
}

async function detectMakeTest(workspaceDir: string): Promise<TestDetectionResult | undefined> {
  const makePath = path.join(workspaceDir, "Makefile");
  try {
    const content = await fs.readFile(makePath, "utf-8");
    // Look for `test:` target (at start of line)
    if (/^test\s*:/m.test(content)) {
      return { command: "cd /workspace && make test" };
    }
  } catch {
    // No Makefile
  }
  return undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ── Test-Fix Loop ────────────────────────────────────────────────────

export interface RunTestFixLoopOptions {
  chunkName: string;
  sessionKey: string;
  workspaceDir: string;
  containerManager: ContainerManager;
  config: JinxConfig;
  testFixConfig: MarathonTestFixConfig;
  sessions: SessionStore;
  chunkTools: AgentToolDefinition[];
  channel: string;
  senderName: string;
}

/**
 * Run the test-fix loop after a chunk completes.
 * 1. Detect test command
 * 2. Run tests
 * 3. If fail → build fix prompt, call agent, rerun tests
 * 4. Repeat up to maxIterations
 *
 * Returns undefined if no tests were detected.
 */
export async function runTestFixLoop(
  opts: RunTestFixLoopOptions,
): Promise<TestFixResult | undefined> {
  const { chunkName, sessionKey, workspaceDir, containerManager, testFixConfig } = opts;

  // Detect test command
  const detection = await detectTestCommand(workspaceDir);
  if (!detection) {
    logger.info(`No test command detected for chunk "${chunkName}", skipping test-fix loop`);
    return undefined;
  }

  logger.info(`Test command detected: ${detection.command} (chunk="${chunkName}")`);

  // Run initial test
  let testOutput = await runTestCommand(
    containerManager,
    sessionKey,
    detection.command,
    testFixConfig.testTimeoutMs,
  );

  if (testOutput.passed) {
    logger.info(`Tests passed on first run for chunk "${chunkName}"`);
    return {
      testsPassed: true,
      fixIterations: 0,
      testCommand: detection.command,
    };
  }

  // Test-fix iterations
  for (let i = 1; i <= testFixConfig.maxIterations; i++) {
    logger.info(`Test-fix iteration ${i}/${testFixConfig.maxIterations} for chunk "${chunkName}"`);

    // Truncate output for prompt
    const truncatedOutput =
      testOutput.output.length > testFixConfig.maxTestOutputChars
        ? testOutput.output.slice(0, testFixConfig.maxTestOutputChars) + "\n... (output truncated)"
        : testOutput.output;

    const fixPrompt = buildTestFixPrompt(
      chunkName,
      detection.command,
      truncatedOutput,
      i,
      testFixConfig.maxIterations,
    );

    // Use a fresh transcript for the fix iteration
    const fixSessionKey = `${sessionKey}:fix-${i}`;
    const fixTranscriptPath = resolveTranscriptPath(fixSessionKey);

    try {
      await withTimeout(
        runAgent({
          prompt: fixPrompt,
          sessionKey: fixSessionKey,
          sessionType: "main",
          tier: "subagent",
          transcriptPath: fixTranscriptPath,
          config: opts.config,
          sessions: opts.sessions,
          tools: opts.chunkTools,
          channel: opts.channel,
          senderName: opts.senderName,
          workspaceDir,
        }),
        testFixConfig.testTimeoutMs * 2, // Give fix iterations more time
        `Test-fix iteration ${i} timed out`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Test-fix iteration ${i} failed: ${msg}`);
      continue;
    }

    // Re-run tests
    testOutput = await runTestCommand(
      containerManager,
      sessionKey,
      detection.command,
      testFixConfig.testTimeoutMs,
    );

    if (testOutput.passed) {
      logger.info(`Tests passed after ${i} fix iteration(s) for chunk "${chunkName}"`);
      return {
        testsPassed: true,
        fixIterations: i,
        testCommand: detection.command,
      };
    }
  }

  // Max iterations reached, tests still failing
  logger.warn(
    `Tests still failing after ${testFixConfig.maxIterations} fix iterations for chunk "${chunkName}"`,
  );
  return {
    testsPassed: false,
    fixIterations: testFixConfig.maxIterations,
    finalTestOutput: testOutput.output.slice(0, testFixConfig.maxTestOutputChars),
    testCommand: detection.command,
  };
}

// ── Acceptance Criteria Verification ─────────────────────────────────

export interface VerifyCriteriaOptions {
  criteria: string[];
  workspaceDir: string;
  containerManager?: ContainerManager;
  sessionKey: string;
}

/**
 * Verify acceptance criteria for a chunk.
 * Supports four criterion types:
 *   - "file_exists: <path>" — file must exist in workspace
 *   - "command_succeeds: <command>" — shell command must exit 0 in container
 *   - "file_contains: <path> :: <text>" — file must contain given text
 *   - "tests_pass" — project test suite must pass
 *
 * Unknown formats are hard failures (not machine-verifiable).
 */
export async function verifyAcceptanceCriteria(
  opts: VerifyCriteriaOptions,
): Promise<CriteriaVerificationResult> {
  const { criteria, workspaceDir, containerManager, sessionKey } = opts;
  const results: CriterionResult[] = [];

  for (const criterion of criteria) {
    const result = await verifySingleCriterion(
      criterion,
      workspaceDir,
      containerManager,
      sessionKey,
    );
    results.push(result);
  }

  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.filter((r) => !r.passed).length;

  return {
    allPassed: failCount === 0,
    results,
    passCount,
    failCount,
  };
}

async function verifySingleCriterion(
  criterion: string,
  workspaceDir: string,
  containerManager?: ContainerManager,
  sessionKey?: string,
): Promise<CriterionResult> {
  const trimmed = criterion.trim();

  // file_exists: <relative-path>
  if (trimmed.startsWith("file_exists:")) {
    const relPath = trimmed.slice("file_exists:".length).trim();
    const fullPath = path.join(workspaceDir, relPath);
    try {
      await fs.access(fullPath);
      return { criterion, passed: true, detail: `${relPath} exists` };
    } catch {
      return { criterion, passed: false, detail: `${relPath} not found` };
    }
  }

  // file_contains: <relative-path> :: <text>
  if (trimmed.startsWith("file_contains:")) {
    const rest = trimmed.slice("file_contains:".length).trim();
    const separatorIdx = rest.indexOf("::");
    if (separatorIdx === -1) {
      return { criterion, passed: false, detail: "Invalid format: missing '::' separator" };
    }
    const relPath = rest.slice(0, separatorIdx).trim();
    const expectedText = rest.slice(separatorIdx + 2).trim();
    const fullPath = path.join(workspaceDir, relPath);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      if (content.includes(expectedText)) {
        return { criterion, passed: true, detail: `${relPath} contains "${expectedText}"` };
      }
      return {
        criterion,
        passed: false,
        detail: `${relPath} does not contain "${expectedText}"`,
      };
    } catch {
      return { criterion, passed: false, detail: `${relPath} not found` };
    }
  }

  // command_succeeds: <shell command>
  if (trimmed.startsWith("command_succeeds:")) {
    const command = trimmed.slice("command_succeeds:".length).trim();
    if (!containerManager || !sessionKey) {
      return { criterion, passed: false, detail: "No container available to run command" };
    }
    try {
      const result = await containerManager.exec(sessionKey, command, { timeoutMs: 120_000 });
      if (result.exitCode === 0 && !result.timedOut) {
        return { criterion, passed: true, detail: `Command exited 0` };
      }
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 500);
      return {
        criterion,
        passed: false,
        detail: `Command exited ${result.exitCode}${result.timedOut ? " (timed out)" : ""}:\n${output}`,
      };
    } catch (err) {
      return {
        criterion,
        passed: false,
        detail: `Command execution error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // tests_pass — detect and run the project test suite
  if (trimmed === "tests_pass") {
    const detection = await detectTestCommand(workspaceDir);
    if (!detection) {
      return { criterion, passed: false, detail: "No test command detected" };
    }
    if (!containerManager || !sessionKey) {
      return { criterion, passed: false, detail: "No container available to run tests" };
    }
    const testResult = await runTestCommand(
      containerManager,
      sessionKey,
      detection.command,
      120_000,
    );
    if (testResult.passed) {
      return { criterion, passed: true, detail: `Tests passed (${detection.command})` };
    }
    return {
      criterion,
      passed: false,
      detail: `Tests failed (${detection.command}):\n${testResult.output.slice(0, 500)}`,
    };
  }

  // Unknown format — fail fast so criteria stay machine-verifiable.
  logger.warn(`Unrecognized criterion format: ${trimmed}`);
  return {
    criterion,
    passed: false,
    detail:
      "Unknown criterion format. Use one of: file_exists:, command_succeeds:, file_contains:, tests_pass",
  };
}

// ── Test Command Runner ──────────────────────────────────────────────

interface TestRunResult {
  passed: boolean;
  output: string;
}

async function runTestCommand(
  containerManager: ContainerManager,
  sessionKey: string,
  command: string,
  timeoutMs: number,
): Promise<TestRunResult> {
  try {
    const result = await containerManager.exec(sessionKey, command, { timeoutMs });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    return {
      passed: result.exitCode === 0 && !result.timedOut,
      output,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      output: `Test execution error: ${msg}`,
    };
  }
}
