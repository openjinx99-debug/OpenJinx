import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { resolveHomeDir, ensureHomeDir } from "../../infra/home-dir.js";
import { resolveAuth } from "../../providers/auth.js";
import { ensureWorkspace } from "../../workspace/bootstrap.js";

export const onboardCommand = new Command("onboard")
  .description("Bootstrap Jinx home directory, config, and workspace templates")
  .action(async () => {
    console.log("Bootstrapping Jinx...\n");

    // 1. Ensure home directory
    const homeDir = resolveHomeDir();
    ensureHomeDir();
    console.log(`Home directory: ${homeDir}`);

    // 2. Generate config file if missing
    const configPath = path.join(homeDir, "config.yaml");
    if (!fs.existsSync(configPath)) {
      const configYaml = yaml.stringify(DEFAULT_CONFIG, {
        indent: 2,
        lineWidth: 120,
      });
      fs.writeFileSync(configPath, configYaml, "utf-8");
      console.log(`Created config: ${configPath}`);
    } else {
      console.log(`Config already exists: ${configPath}`);
    }

    // 3. Create workspace
    const workspaceDir = path.join(homeDir, "workspace");
    await ensureWorkspace(workspaceDir);
    console.log(`Workspace ready: ${workspaceDir}`);

    // 4. Check Claude auth
    try {
      const auth = resolveAuth();
      console.log(`Claude auth: ${auth.mode === "oauth" ? "OAuth token" : "API key"} found`);
    } catch {
      console.log(
        "\nNo Claude auth found. Set one of:\n" +
          "  # Option 1: put credentials in ~/.jinx/.env (auto-loaded)\n" +
          "  ANTHROPIC_API_KEY=sk-ant-...\n" +
          "  CLAUDE_CODE_OAUTH_TOKEN=...\n\n" +
          "  # Option 2: export in your shell\n" +
          "  export ANTHROPIC_API_KEY=sk-ant-...\n" +
          "  export CLAUDE_CODE_OAUTH_TOKEN=...\n\n" +
          "  # Option 3 (macOS): run `claude login` and reuse Keychain OAuth\n",
      );
    }

    console.log("\nBootstrap complete! Run `jinx chat` to start a conversation.");
    console.log(
      "Tip: For a guided setup experience, run `claude` in the repo root and type `/setup`.",
    );
  });
