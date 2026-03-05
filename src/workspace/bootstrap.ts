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

const IDENTITY_NAME_PLACEHOLDER = "<!-- Choose a name during bootstrap -->";

/**
 * Replace the name placeholder in IDENTITY.md with the chosen assistant name.
 * No-ops if the file is missing or the placeholder has already been replaced.
 */
export async function populateIdentityName(workspaceDir: string, name: string): Promise<void> {
  const identityPath = path.join(workspaceDir, "IDENTITY.md");

  let content: string;
  try {
    content = await fs.readFile(identityPath, "utf-8");
  } catch {
    return;
  }

  if (!content.includes(IDENTITY_NAME_PLACEHOLDER)) {
    return;
  }

  const updated = content.replace(IDENTITY_NAME_PLACEHOLDER, name);
  await fs.writeFile(identityPath, updated, "utf-8");
  logger.info(`Identity name set to: ${name}`);
}
