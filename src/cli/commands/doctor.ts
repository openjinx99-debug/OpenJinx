import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { resolveConfigPath } from "../../config/loader.js";
import { resolveHomeDir } from "../../infra/home-dir.js";
import { hasAuth } from "../../providers/auth.js";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export const doctorCommand = new Command("doctor")
  .description("Check system health and configuration")
  .action(async () => {
    console.log("Jinx Doctor - System Health Check\n");

    const checks: CheckResult[] = [];

    // 1. Home directory
    const homeDir = resolveHomeDir();
    checks.push({
      name: "Home directory",
      ok: fs.existsSync(homeDir),
      detail: homeDir,
    });

    // 2. Config file
    const configPath = resolveConfigPath();
    const configExists = !!configPath && fs.existsSync(configPath);
    checks.push({
      name: "Config file",
      ok: configExists,
      detail: configPath ?? "not found",
    });

    // 3. Workspace
    const workspaceDir = path.join(homeDir, "workspace");
    const workspaceExists = fs.existsSync(workspaceDir);
    checks.push({
      name: "Workspace",
      ok: workspaceExists,
      detail: workspaceDir,
    });

    // 4. Claude auth
    const authOk = hasAuth();
    checks.push({
      name: "Claude auth",
      ok: authOk,
      detail: authOk
        ? process.env.CLAUDE_CODE_OAUTH_TOKEN
          ? "OAuth token"
          : "API key"
        : "No auth found",
    });

    // 5. Node version
    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1), 10);
    checks.push({
      name: "Node.js",
      ok: nodeMajor >= 22,
      detail: nodeVersion,
    });

    // Print results
    let allOk = true;
    for (const check of checks) {
      const icon = check.ok ? "OK" : "FAIL";
      console.log(`  [${icon}] ${check.name}: ${check.detail}`);
      if (!check.ok) {
        allOk = false;
      }
    }

    console.log(allOk ? "\nAll checks passed!" : "\nSome checks failed.");
    process.exitCode = allOk ? 0 : 1;
  });
