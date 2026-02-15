import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveHomeDir } from "../../infra/home-dir.js";
import { WORKSPACE_FILES } from "../../workspace/loader.js";

const TEMPLATES_DIR = new URL("../../workspace/templates/", import.meta.url);

/** Files that get reset to templates. SOUL.md and AGENTS.md are kept. */
const RESET_FILES = ["IDENTITY.md", "USER.md", "MEMORY.md", "BOOTSTRAP.md", "HEARTBEAT.md"];

export const workspaceCommand = new Command("workspace")
  .description("Workspace management")
  .addCommand(
    new Command("reset")
      .description("Reset workspace files to fresh templates (for re-onboarding)")
      .option("-a, --all", "Reset ALL workspace files including SOUL.md and AGENTS.md")
      .action(async (opts) => {
        const homeDir = resolveHomeDir();
        const workspaceDir = path.join(homeDir, "workspace");

        const filesToReset = opts.all ? [...WORKSPACE_FILES] : RESET_FILES;

        console.log(`Resetting workspace files in ${workspaceDir}:\n`);

        for (const filename of filesToReset) {
          const filePath = path.join(workspaceDir, filename);
          const templatePath = new URL(filename, TEMPLATES_DIR);

          try {
            const content = await fs.readFile(templatePath, "utf-8");
            await fs.writeFile(filePath, content, "utf-8");
            console.log(`  ✓ ${filename} → reset to template`);
          } catch {
            console.log(`  ✗ ${filename} — template not found, skipped`);
          }
        }

        console.log("\nWorkspace reset complete. Run `jinx chat` to start fresh.");
      }),
  )
  .addCommand(
    new Command("show").description("Show current workspace file status").action(async () => {
      const homeDir = resolveHomeDir();
      const workspaceDir = path.join(homeDir, "workspace");

      console.log(`Workspace: ${workspaceDir}\n`);

      for (const filename of WORKSPACE_FILES) {
        const filePath = path.join(workspaceDir, filename);
        try {
          const stat = await fs.stat(filePath);
          const content = await fs.readFile(filePath, "utf-8");
          const lines = content.split("\n").length;
          const isTemplate = content.includes("<!-- Fill in") || content.includes("<!-- Curated");
          const status = isTemplate ? "template" : "customised";
          console.log(`  ${filename}  ${lines} lines, ${stat.size}B [${status}]`);
        } catch {
          console.log(`  ${filename}  [missing]`);
        }
      }
    }),
  );
