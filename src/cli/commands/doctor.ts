import { Command } from "commander";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { JinxConfig } from "../../types/config.js";
import type { SetupStepName } from "../../types/onboarding.js";
import { resolveConfigPath } from "../../config/loader.js";
import { loadAndValidateConfig } from "../../config/validation.js";
import { fetchWithRetry } from "../../infra/fetch-retry.js";
import { resolveHomeDir } from "../../infra/home-dir.js";
import { readSetupState } from "../../onboarding/state.js";
import { hasAuth, resolveAuth } from "../../providers/auth.js";

type CheckStatus = "ok" | "fail" | "skip" | "warn";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

const LIVE_TIMEOUT_MS = 5_000;
const REQUIRED_SETUP_STEPS: readonly SetupStepName[] = [
  "prerequisites",
  "dependencies",
  "assistantName",
  "apiKeys",
  "bootstrap",
  "verify",
];

function statusIcon(status: CheckStatus): string {
  switch (status) {
    case "ok":
      return "OK";
    case "fail":
      return "FAIL";
    case "skip":
      return "SKIP";
    case "warn":
      return "WARN";
  }
}

function printSection(title: string, checks: CheckResult[]): void {
  console.log(`  ${title}:`);
  for (const check of checks) {
    console.log(`  [${statusIcon(check.status)}] ${check.name}: ${check.detail}`);
  }
  console.log();
}

function extractErrorDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 2)
    .join(" | ");
}

// ── Tier 1: Structure checks ───────────────────────────────────────────

function runStructureChecks(): CheckResult[] {
  const checks: CheckResult[] = [];

  const homeDir = resolveHomeDir();
  checks.push({
    name: "Home directory",
    status: fs.existsSync(homeDir) ? "ok" : "fail",
    detail: homeDir,
  });

  const configPath = resolveConfigPath();
  const configExists = !!configPath && fs.existsSync(configPath);
  checks.push({
    name: "Config file",
    status: configExists ? "ok" : "fail",
    detail: configPath ?? "not found",
  });

  const workspaceDir = path.join(homeDir, "workspace");
  checks.push({
    name: "Workspace",
    status: fs.existsSync(workspaceDir) ? "ok" : "fail",
    detail: workspaceDir,
  });

  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    name: "Node.js",
    status: nodeMajor >= 22 ? "ok" : "fail",
    detail: nodeVersion,
  });

  return checks;
}

async function loadConfigWithValidation(): Promise<{
  config?: JinxConfig;
  validationCheck: CheckResult;
}> {
  const configPath = resolveConfigPath();
  const configExists = fs.existsSync(configPath);

  try {
    const config = await loadAndValidateConfig();
    return {
      config,
      validationCheck: {
        name: "Config validation",
        status: configExists ? "ok" : "skip",
        detail: configExists ? "schema valid" : "config missing (defaults loaded for checks)",
      },
    };
  } catch (err) {
    return {
      validationCheck: {
        name: "Config validation",
        status: "fail",
        detail: extractErrorDetail(err),
      },
    };
  }
}

// ── Tier 2: Live API validation ────────────────────────────────────────

async function checkClaudeAuth(): Promise<CheckResult> {
  if (!hasAuth()) {
    return { name: "Claude auth", status: "fail", detail: "No auth found" };
  }

  try {
    const auth = resolveAuth();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };

    if (auth.mode === "api-key") {
      headers["x-api-key"] = auth.key;
    } else {
      headers["authorization"] = `Bearer ${auth.token}`;
      // OAuth requires the beta header for the API to accept Bearer tokens
      headers["anthropic-beta"] = "oauth-2025-04-20";
    }

    const resp = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      },
      0,
    );

    if (resp.ok) {
      const mode = auth.mode === "oauth" ? "OAuth token" : "API key";
      return { name: "Claude auth", status: "ok", detail: `${mode} valid` };
    }

    if (resp.status === 401) {
      return {
        name: "Claude auth",
        status: "fail",
        detail: "401 Unauthorized — check your API key",
      };
    }

    // 400, 403, etc. — auth is likely valid but request may be malformed
    // For a health check, if we get past 401 the key is valid
    const mode = auth.mode === "oauth" ? "OAuth token" : "API key";
    return { name: "Claude auth", status: "ok", detail: `${mode} valid (status ${resp.status})` };
  } catch (err) {
    return { name: "Claude auth", status: "fail", detail: `Connection error: ${String(err)}` };
  }
}

async function checkOpenAiEmbeddings(): Promise<CheckResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { name: "OpenAI embeddings", status: "skip", detail: "key not set (BM25 only)" };
  }

  try {
    const resp = await fetchWithRetry(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: "health check",
        }),
        signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      },
      0,
    );

    if (resp.ok) {
      return {
        name: "OpenAI embeddings",
        status: "ok",
        detail: "key valid (text-embedding-3-small)",
      };
    }

    if (resp.status === 401) {
      return {
        name: "OpenAI embeddings",
        status: "fail",
        detail: "401 Unauthorized — check your API key",
      };
    }

    return { name: "OpenAI embeddings", status: "fail", detail: `HTTP ${resp.status}` };
  } catch (err) {
    return {
      name: "OpenAI embeddings",
      status: "fail",
      detail: `Connection error: ${String(err)}`,
    };
  }
}

async function checkOpenRouterWebSearch(): Promise<CheckResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { name: "OpenRouter web search", status: "skip", detail: "key not set" };
  }

  try {
    const resp = await fetchWithRetry(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "perplexity/sonar-pro",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      },
      0,
    );

    if (resp.ok) {
      return {
        name: "OpenRouter web search",
        status: "ok",
        detail: "key valid (perplexity/sonar-pro)",
      };
    }

    if (resp.status === 401) {
      return {
        name: "OpenRouter web search",
        status: "fail",
        detail: "401 Unauthorized — check your API key",
      };
    }

    return { name: "OpenRouter web search", status: "fail", detail: `HTTP ${resp.status}` };
  } catch (err) {
    return {
      name: "OpenRouter web search",
      status: "fail",
      detail: `Connection error: ${String(err)}`,
    };
  }
}

async function checkComposio(config: JinxConfig | undefined): Promise<CheckResult> {
  if (!config?.composio.enabled) {
    return { name: "Composio", status: "skip", detail: "not enabled" };
  }

  const apiKey = config.composio.apiKey ?? process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    return { name: "Composio", status: "fail", detail: "enabled but no API key set" };
  }

  try {
    const resp = await fetchWithRetry(
      "https://backend.composio.dev/api/v1/connectedAccounts",
      {
        method: "GET",
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      },
      0,
    );

    if (resp.ok) {
      return { name: "Composio", status: "ok", detail: "key valid" };
    }

    if (resp.status === 401) {
      return { name: "Composio", status: "fail", detail: "401 Unauthorized — check your API key" };
    }

    return { name: "Composio", status: "fail", detail: `HTTP ${resp.status}` };
  } catch (err) {
    return { name: "Composio", status: "fail", detail: `Connection error: ${String(err)}` };
  }
}

async function runApiChecks(config: JinxConfig | undefined): Promise<CheckResult[]> {
  const results = await Promise.all([
    checkClaudeAuth(),
    checkOpenAiEmbeddings(),
    checkOpenRouterWebSearch(),
    checkComposio(config),
  ]);
  return results;
}

// ── Tier 3: Channel & security checks ──────────────────────────────────

async function checkTelegram(config: JinxConfig | undefined): Promise<CheckResult> {
  if (!config?.channels.telegram.enabled) {
    return { name: "Telegram", status: "skip", detail: "not enabled" };
  }

  const tg = config.channels.telegram;
  if (!tg.botToken) {
    return { name: "Telegram", status: "fail", detail: "enabled but no botToken set" };
  }

  // Verify token with getMe
  try {
    const resp = await fetchWithRetry(
      `https://api.telegram.org/bot${tg.botToken}/getMe`,
      { method: "GET", signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) },
      0,
    );

    if (!resp.ok) {
      return {
        name: "Telegram",
        status: "fail",
        detail: `bot token invalid (HTTP ${resp.status})`,
      };
    }

    const data = (await resp.json()) as { result?: { username?: string } };
    const username = data.result?.username ?? "unknown";

    const chatIds = tg.allowedChatIds ?? [];
    if (chatIds.length === 0 && tg.dmPolicy !== "disabled") {
      return {
        name: "Telegram",
        status: "warn",
        detail: `bot @${username} responding, but no allowedChatIds set — consider adding your user ID`,
      };
    }

    return {
      name: "Telegram",
      status: "ok",
      detail: `bot @${username} responding, locked to ${chatIds.length} user(s)`,
    };
  } catch (err) {
    return { name: "Telegram", status: "fail", detail: `Connection error: ${String(err)}` };
  }
}

function checkWhatsApp(config: JinxConfig | undefined): CheckResult {
  if (!config?.channels.whatsapp.enabled) {
    return { name: "WhatsApp", status: "skip", detail: "not enabled" };
  }

  const wa = config.channels.whatsapp;
  const authDir = wa.authDir ?? path.join(resolveHomeDir(), "whatsapp-auth");
  const credsFile = path.join(authDir, "creds.json");
  const hasCredentials = fs.existsSync(credsFile);

  const allowFrom = wa.allowFrom ?? [];

  if (!hasCredentials) {
    return {
      name: "WhatsApp",
      status: "warn",
      detail: "enabled but no credentials found — scan QR code on first gateway start",
    };
  }

  if (allowFrom.length === 0 && wa.dmPolicy !== "disabled") {
    return {
      name: "WhatsApp",
      status: "warn",
      detail: "credentials present, but no allowFrom set — consider adding your phone number",
    };
  }

  const maskedNumbers = allowFrom.map((n) =>
    n.length > 6 ? n.slice(0, 4) + "xxx" + n.slice(-2) : n,
  );
  return {
    name: "WhatsApp",
    status: "ok",
    detail: `credentials present, locked to ${maskedNumbers.join(", ")}`,
  };
}

function checkSandbox(): CheckResult {
  if (process.platform !== "darwin") {
    return { name: "Sandbox", status: "skip", detail: "Apple Container (macOS only)" };
  }

  try {
    execSync("container list 2>/dev/null", { timeout: 3_000, stdio: "pipe" });
    return { name: "Sandbox", status: "ok", detail: "Apple Container available" };
  } catch {
    return { name: "Sandbox", status: "skip", detail: "Apple Container not available" };
  }
}

async function runChannelChecks(config: JinxConfig | undefined): Promise<CheckResult[]> {
  const telegram = await checkTelegram(config);
  return [telegram, checkWhatsApp(config), checkSandbox()];
}

// ── Tier 4: Onboarding readiness checks ─────────────────────────────────

async function checkSetupState(): Promise<CheckResult> {
  try {
    const setupState = await readSetupState();
    if (!setupState) {
      return {
        name: "Setup state",
        status: "skip",
        detail: "not found (run /setup to track guided progress)",
      };
    }

    const blockedSteps = REQUIRED_SETUP_STEPS.filter(
      (step) => setupState.steps[step] === "blocked",
    );
    if (setupState.blockedReason || blockedSteps.length > 0) {
      const reason =
        setupState.blockedReason ?? `blocked required step(s): ${blockedSteps.join(", ")}`;
      return { name: "Setup state", status: "fail", detail: reason };
    }

    const incompleteRequired = REQUIRED_SETUP_STEPS.filter(
      (step) => setupState.steps[step] !== "completed",
    );
    if (incompleteRequired.length > 0) {
      return {
        name: "Setup state",
        status: "warn",
        detail: `incomplete required step(s): ${incompleteRequired.join(", ")}`,
      };
    }

    return { name: "Setup state", status: "ok", detail: "required guided setup steps completed" };
  } catch (err) {
    return {
      name: "Setup state",
      status: "warn",
      detail: `could not read setup-state (${extractErrorDetail(err)})`,
    };
  }
}

async function runOnboardingChecks(): Promise<CheckResult[]> {
  return [await checkSetupState()];
}

function getRemediationHint(check: CheckResult): string | undefined {
  switch (check.name) {
    case "Home directory":
    case "Config file":
    case "Workspace":
      return "Run `pnpm dev -- onboard` to create the baseline ~/.jinx setup.";
    case "Node.js":
      return "Install Node.js 22.12.0+ and rerun `pnpm dev -- doctor --onboarding`.";
    case "Config validation":
      return "Fix `~/.jinx/config.yaml` and validate with `pnpm dev -- config validate`.";
    case "Claude auth":
      return "Run `claude login` (macOS) or set `ANTHROPIC_API_KEY` in `~/.jinx/.env`.";
    case "OpenAI embeddings":
      return "Add `OPENAI_API_KEY` in `~/.jinx/.env`, or keep BM25-only memory search.";
    case "OpenRouter web search":
      return "Add `OPENROUTER_API_KEY` in `~/.jinx/.env`, or keep web search disabled.";
    case "Composio":
      return "Set `COMPOSIO_API_KEY` and enable `composio.enabled` only if needed.";
    case "Telegram":
      if (check.status === "warn") {
        return "Set `channels.telegram.allowedChatIds` to lock the bot to your account.";
      }
      return "Set `channels.telegram.botToken` in config and verify with BotFather.";
    case "WhatsApp":
      if (check.detail.includes("no credentials found")) {
        return "Run `pnpm dev -- gateway` and scan the WhatsApp QR code once.";
      }
      if (check.detail.includes("no allowFrom set")) {
        return "Set `channels.whatsapp.allowFrom` to lock access to your phone number.";
      }
      return "Review `channels.whatsapp` settings in `~/.jinx/config.yaml`.";
    case "Setup state":
      if (check.status === "skip") {
        return "Run `/setup` if you want guided setup progress tracking.";
      }
      return "Inspect and update state with `pnpm dev -- setup-state show --json`.";
    default:
      return undefined;
  }
}

function printOnboardingReadiness(allChecks: CheckResult[]): void {
  const blockers = allChecks.filter((check) => check.status === "fail");
  const warnings = allChecks.filter((check) => check.status === "warn");

  console.log("  Onboarding readiness:");

  if (blockers.length === 0) {
    console.log("  [OK] No blockers detected.");
  } else {
    console.log(`  [FAIL] ${blockers.length} blocker(s) detected.`);
    for (const blocker of blockers) {
      console.log(`  - ${blocker.name}: ${blocker.detail}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`  [WARN] ${warnings.length} warning(s) detected.`);
    for (const warning of warnings) {
      console.log(`  - ${warning.name}: ${warning.detail}`);
    }
  }

  const needsAction = [...blockers, ...warnings];
  if (needsAction.length > 0) {
    console.log("\n  Recommended fixes:");
    for (const check of needsAction) {
      const hint = getRemediationHint(check);
      if (hint) {
        console.log(`  - ${check.name}: ${hint}`);
      }
    }
  }

  console.log();
}

// ── Main ────────────────────────────────────────────────────────────────

export const doctorCommand = new Command("doctor")
  .description("Check system health and configuration")
  .option(
    "--onboarding",
    "show onboarding readiness blockers and recommended fixes (includes live checks)",
  )
  .action(async (options: { onboarding?: boolean }) => {
    const onboardingMode = !!options.onboarding;
    console.log(
      onboardingMode
        ? "Jinx Doctor - Onboarding Readiness Check\n"
        : "Jinx Doctor - System Health Check\n",
    );

    // Tier 1: Structure
    const structureChecks = runStructureChecks();

    // Config validation
    const { config, validationCheck } = await loadConfigWithValidation();
    structureChecks.push(validationCheck);
    printSection("Structure", structureChecks);

    // Tier 2: API keys (live validation)
    const apiChecks = await runApiChecks(config);
    printSection("API Keys (live validation)", apiChecks);

    // Tier 3: Channels & security
    const channelChecks = await runChannelChecks(config);
    printSection("Channels & Security", channelChecks);

    // Tier 4: Onboarding mode checks
    const onboardingChecks = onboardingMode ? await runOnboardingChecks() : [];
    if (onboardingChecks.length > 0) {
      printSection("Onboarding State", onboardingChecks);
    }

    // Summary
    const allChecks = [...structureChecks, ...apiChecks, ...channelChecks, ...onboardingChecks];
    const hasFail = allChecks.some((c) => c.status === "fail");
    const hasWarn = allChecks.some((c) => c.status === "warn");

    if (onboardingMode) {
      printOnboardingReadiness(allChecks);
    }

    if (hasFail) {
      console.log(onboardingMode ? "Onboarding is not ready yet." : "Some checks failed.");
    } else if (hasWarn) {
      console.log(
        onboardingMode
          ? "Onboarding is ready with warnings."
          : "All checks passed (with warnings).",
      );
    } else {
      console.log(onboardingMode ? "Onboarding readiness check passed!" : "All checks passed!");
    }

    process.exitCode = hasFail ? 1 : 0;
  });
