import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import YAML from "yaml";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { loadRawConfig } from "../../config/loader.js";
import { loadAndValidateConfig } from "../../config/validation.js";
import { ensureHomeDir, resolveHomeDir } from "../../infra/home-dir.js";
import { ensureSetupState, setSetupAssistantName, setSetupStep } from "../../onboarding/state.js";
import { hasAuth, resolveAuth } from "../../providers/auth.js";
import { ensureWorkspace, populateIdentityName } from "../../workspace/bootstrap.js";

// ─── WizardIO ────────────────────────────────────────────────────────────────

export interface WizardIO {
  ask(prompt: string, defaultValue?: string): Promise<string>;
  askSecret(prompt: string): Promise<string>;
  confirm(prompt: string, defaultYes?: boolean): Promise<boolean>;
}

// ─── Readline factory ────────────────────────────────────────────────────────

type RlWithOutput = { _writeToOutput?: (s: string) => void };

function createReadlineIO(): { io: WizardIO; close: () => void } {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const ask = (prompt: string, defaultValue?: string): Promise<string> =>
    new Promise((resolve) => {
      const display = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `;
      rl.question(display, (answer) => {
        const trimmed = answer.trim();
        resolve(trimmed !== "" ? trimmed : (defaultValue ?? ""));
      });
    });

  const askSecret = (prompt: string): Promise<string> =>
    new Promise((resolve) => {
      process.stdout.write(`${prompt}: `);
      const orig = (rl as unknown as RlWithOutput)._writeToOutput;
      (rl as unknown as RlWithOutput)._writeToOutput = () => {};
      rl.question("", (answer) => {
        (rl as unknown as RlWithOutput)._writeToOutput = orig;
        process.stdout.write("\n");
        resolve(answer.trim());
      });
    });

  const confirm = async (prompt: string, defaultYes?: boolean): Promise<boolean> => {
    const hint = defaultYes === true ? "[Y/n]" : defaultYes === false ? "[y/N]" : "[y/n]";
    const answer = await ask(`${prompt} ${hint}`);
    if (answer === "" || answer === hint) {
      return defaultYes ?? false;
    }
    return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
  };

  return { io: { ask, askSecret, confirm }, close: () => rl.close() };
}

// ─── .env helpers ────────────────────────────────────────────────────────────

function readEnvLines(envPath: string): string[] {
  if (!fs.existsSync(envPath)) {
    return [];
  }
  return fs.readFileSync(envPath, "utf-8").split("\n");
}

function upsertEnvLine(lines: string[], key: string, value: string): string[] {
  const prefix = `${key}=`;
  const newLine = `${key}=${value}`;
  const idx = lines.findIndex((l) => l.startsWith(prefix));
  if (idx >= 0) {
    return lines.map((l, i) => (i === idx ? newLine : l));
  }
  return [...lines.filter((l) => l !== ""), newLine];
}

function setEnvKey(envPath: string, key: string, value: string): void {
  const lines = upsertEnvLine(readEnvLines(envPath), key, value);
  const content = lines.filter((l) => l !== "").join("\n") + "\n";
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, content, { encoding: "utf-8", mode: 0o600 });
  process.env[key] = value;
}

// ─── Config helpers ──────────────────────────────────────────────────────────

function deepSet(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== "object" || cur[k] === null) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

async function setConfigKeys(configPath: string, updates: Record<string, unknown>): Promise<void> {
  const raw = await loadRawConfig(configPath);
  for (const [dotPath, value] of Object.entries(updates)) {
    deepSet(raw, dotPath.split("."), value);
  }
  fs.writeFileSync(configPath, YAML.stringify(raw, { indent: 2, lineWidth: 120 }), "utf-8");
}

// ─── Wizard core ─────────────────────────────────────────────────────────────

export async function runOnboard(io: WizardIO, homeDir: string): Promise<void> {
  const configPath = path.join(homeDir, "config.yaml");
  const envPath = path.join(homeDir, ".env");
  const workspaceDir = path.join(homeDir, "workspace");

  console.log("\nWelcome to Jinx setup!\n");

  // ── Step 1: Prerequisites ─────────────────────────────────────────────────
  console.log("Step 1/6  Prerequisites");
  ensureHomeDir();

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      YAML.stringify(DEFAULT_CONFIG, { indent: 2, lineWidth: 120 }),
      "utf-8",
    );
    console.log(`  Created config: ${configPath}`);
  } else {
    console.log(`  Config: ${configPath} (exists)`);
  }

  let state = await ensureSetupState();

  if (state.steps.prerequisites !== "completed") {
    const nodeVer = process.versions.node;
    const major = parseInt(nodeVer.split(".")[0], 10);
    if (major < 22) {
      console.log(`  WARN Node ${nodeVer} detected — Jinx requires Node >= 22.12.0`);
    } else {
      console.log(`  Node ${nodeVer}: OK`);
    }
    await setSetupStep("prerequisites", "completed");
    await setSetupStep("dependencies", "completed");
  } else {
    console.log("  Prerequisites: already verified");
  }

  // ── Step 2: Assistant name ────────────────────────────────────────────────
  console.log("\nStep 2/6  Assistant name");
  state = await ensureSetupState();

  if (state.steps.assistantName === "completed") {
    console.log(`  Name: ${state.assistantName} (already set)`);
  } else {
    const name = await io.ask("  What should I call your assistant?", "Jinx");
    await setSetupAssistantName(name);
    await setSetupStep("assistantName", "completed");
    console.log(`  Name set to: ${name}`);
  }

  // ── Step 3: Claude authentication ─────────────────────────────────────────
  console.log("\nStep 3/6  Claude authentication");
  state = await ensureSetupState();

  if (state.steps.apiKeys === "completed" && hasAuth()) {
    const mode = process.env.CLAUDE_CODE_OAUTH_TOKEN
      ? "OAuth token"
      : process.env.ANTHROPIC_API_KEY
        ? "ANTHROPIC_API_KEY"
        : "Keychain OAuth";
    console.log(`  Auth: ${mode} (already configured)`);
  } else if (hasAuth()) {
    const mode = process.env.CLAUDE_CODE_OAUTH_TOKEN
      ? "Claude Code OAuth"
      : process.env.ANTHROPIC_API_KEY
        ? "ANTHROPIC_API_KEY"
        : "Keychain OAuth";
    console.log(`  Found ${mode}`);
    await setSetupStep("apiKeys", "completed");
  } else {
    console.log("  No Claude authentication found.");
    const choice = await io.ask("  [1] Enter API key  [2] Set up manually", "1");
    if (choice === "1") {
      const key = await io.askSecret("  ANTHROPIC_API_KEY (sk-ant-...)");
      if (key) {
        setEnvKey(envPath, "ANTHROPIC_API_KEY", key);
        try {
          resolveAuth();
          await setSetupStep("apiKeys", "completed");
          console.log("  API key saved and verified.");
        } catch {
          console.log("  WARN Key saved but auth verification failed — check the value.");
        }
      }
    } else {
      console.log(
        "\n  Manual setup: add one of these to ~/.jinx/.env\n" +
          "    ANTHROPIC_API_KEY=sk-ant-...\n" +
          "    CLAUDE_CODE_OAUTH_TOKEN=...\n" +
          "  Or run `claude login` to store OAuth in the Keychain.\n",
      );
    }
  }

  // ── Step 4: Optional features ─────────────────────────────────────────────
  console.log("\nStep 4/6  Optional features");

  const optionals: Array<{ key: string; label: string }> = [
    { key: "OPENAI_API_KEY", label: "memory search (OpenAI embeddings)" },
    { key: "OPENROUTER_API_KEY", label: "OpenRouter model routing" },
  ];

  for (const { key, label } of optionals) {
    if (process.env[key]) {
      console.log(`  ${key}: found (${label} enabled)`);
      continue;
    }
    const enable = await io.confirm(`  Enable ${label}? (requires ${key})`, false);
    if (enable) {
      const value = await io.askSecret(`  ${key}`);
      if (value) {
        setEnvKey(envPath, key, value);
        console.log(`  ${key} saved.`);
      }
    }
  }

  // ── Step 5: Channels ──────────────────────────────────────────────────────
  console.log("\nStep 5/6  Channels");
  state = await ensureSetupState();

  // Telegram
  if (state.steps.telegram === "completed") {
    console.log("  Telegram: configured (skipping)");
  } else {
    const enableTg = await io.confirm("  Enable Telegram?", false);
    if (enableTg) {
      const token = await io.askSecret("  Bot token from BotFather");
      const rawIds = await io.ask("  Allowed chat IDs (comma-separated, leave blank to skip)", "");
      const chatIds = rawIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const updates: Record<string, unknown> = {
        "channels.telegram.enabled": true,
        "channels.telegram.botToken": token,
      };
      if (chatIds.length > 0) {
        updates["channels.telegram.allowedChatIds"] = chatIds;
      }
      await setConfigKeys(configPath, updates);
      await setSetupStep("telegram", "completed");
      console.log("  Telegram configured.");
    }
  }

  // WhatsApp
  if (state.steps.whatsapp === "completed") {
    console.log("  WhatsApp: configured (skipping)");
  } else {
    const enableWa = await io.confirm("  Enable WhatsApp?", false);
    if (enableWa) {
      console.log("  WhatsApp: run `pnpm dev -- gateway` to scan the QR code on first start.");
      await setSetupStep("whatsapp", "completed");
    }
  }

  // ── Step 6: Bootstrap workspace + verify ─────────────────────────────────
  console.log("\nStep 6/6  Workspace & verification");
  state = await ensureSetupState();

  await ensureWorkspace(workspaceDir);
  await populateIdentityName(workspaceDir, state.assistantName);
  await setSetupStep("bootstrap", "completed");
  console.log(`  Workspace ready: ${workspaceDir}`);

  const authOk = hasAuth();
  let configOk = false;
  try {
    await loadAndValidateConfig(configPath);
    configOk = true;
  } catch {
    configOk = false;
  }
  const workspaceOk = fs.existsSync(workspaceDir);

  console.log(`  ${authOk ? "[OK]" : "[FAIL]"} Claude auth`);
  console.log(`  ${configOk ? "[OK]" : "[FAIL]"} Config valid`);
  console.log(`  ${workspaceOk ? "[OK]" : "[FAIL]"} Workspace ready`);

  if (authOk && configOk) {
    await setSetupStep("verify", "completed");
    console.log("\nAll done! Run: pnpm dev -- chat");
  } else {
    console.log("\nSetup incomplete — address the [FAIL] items above, then re-run onboard.");
    if (!authOk) {
      console.log("  Auth: set ANTHROPIC_API_KEY in ~/.jinx/.env or run `claude login`");
    }
    if (!configOk) {
      console.log(`  Config: review ${configPath}`);
    }
  }
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

/** Called directly from the CLI router — avoids double-Commander stdin issues. */
export async function runOnboardCli(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("onboard requires an interactive terminal.");
    console.error("Run it directly in your shell:\n  pnpm dev -- onboard");
    process.exit(1);
  }
  const homeDir = resolveHomeDir();
  const { io, close } = createReadlineIO();
  try {
    await runOnboard(io, homeDir);
  } finally {
    close();
  }
}

// Kept for backwards-compatibility with any direct parseAsync callers.
export const onboardCommand = new Command("onboard")
  .description("Interactive setup wizard for Jinx")
  .action(runOnboardCli);
