import fs from "node:fs/promises";
import path from "node:path";
import { expandTilde } from "../infra/home-dir.js";
import { createLogger } from "../infra/logger.js";
import { WORKSPACE_FILES } from "./loader.js";

const logger = createLogger("workspace");

const TEMPLATES_DIR = new URL("./templates/", import.meta.url);

/**
 * Ensure the workspace directory exists and has all template files.
 * Missing files are created from bundled templates; existing files are left untouched.
 */
export async function ensureWorkspace(workspaceDir: string): Promise<void> {
  const dir = expandTilde(workspaceDir);
  await fs.mkdir(dir, { recursive: true });

  for (const filename of WORKSPACE_FILES) {
    const filePath = path.join(dir, filename);
    const exists = await fileExists(filePath);
    if (!exists) {
      const templatePath = new URL(filename, TEMPLATES_DIR);
      try {
        const content = await fs.readFile(templatePath, "utf-8");
        await fs.writeFile(filePath, content, "utf-8");
        logger.info(`Created workspace file: ${filename}`);
      } catch {
        logger.warn(`Template not found for ${filename}, creating empty file`);
        await fs.writeFile(filePath, `# ${filename.replace(".md", "")}\n`, "utf-8");
      }
    }
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
