import fs from "node:fs/promises";
import path from "node:path";
import type { InputFileInfo } from "../types/marathon.js";
import type { OutboundMedia } from "../types/messages.js";
import { createLogger } from "../infra/logger.js";
import { listFilesRecursive } from "./marathon-context.js";
import { DELIVERABLES_MANIFEST } from "./marathon-prompts.js";

const logger = createLogger("marathon-artifacts");

const DELIVERABLE_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "webm",
  "mkv",
  "avi",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "bmp",
  "tiff",
  "mp3",
  "ogg",
  "wav",
  "flac",
  "m4a",
  "aac",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "csv",
  "zip",
  "tar",
  "gz",
  "tgz",
]);

const BUILD_OUTPUT_DIRS = ["dist", "build", "out"];
const MAX_BUILD_OUTPUT_FILES = 500;

const NOISE_PATTERNS = [
  /^CHUNK\d/i,
  /^SETUP_COMPLETE/i,
  /^\.deliverables$/,
  /^\.gitignore$/,
  /^\.DS_Store$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^requirements\.txt$/,
  /^Makefile$/i,
  /^Dockerfile$/i,
  /^\.dockerignore$/,
  /^tsconfig\.json$/,
  /^pyproject\.toml$/,
  /^setup\.(py|cfg)$/,
  /^PROGRESS\.md$/,
];

const BLOCKED_PATH_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "coverage",
]);

const MANIFEST_EXCLUDED_BASENAMES = new Set([
  "readme.md",
  "progress.md",
  "license",
  "license.md",
  "changelog.md",
]);

const PROGRESS_SUMMARY_EXTENSIONS = new Set([...DELIVERABLE_EXTENSIONS, "html", "htm"]);

async function readDeliverables(workspaceDir: string): Promise<string[] | undefined> {
  try {
    const manifestPath = path.join(workspaceDir, DELIVERABLES_MANIFEST);
    const raw = await fs.readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined;
    }

    const resolved: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") {
        continue;
      }
      const cleaned = entry.replace(/^\/workspace\//, "");
      if (!isManifestDeliverablePath(cleaned)) {
        logger.warn(`Deliverable manifest entry rejected as non-deliverable: ${entry}`);
        continue;
      }
      const full = path.join(workspaceDir, cleaned);
      if (!full.startsWith(workspaceDir)) {
        logger.warn(`Deliverable path escapes workspace, skipping: ${entry}`);
        continue;
      }
      try {
        await fs.access(full);
        resolved.push(full);
      } catch {
        logger.warn(`Deliverable not found, skipping: ${entry}`);
      }
    }
    return resolved.length > 0 ? resolved : undefined;
  } catch {
    return undefined;
  }
}

export async function packageDeliverables(
  workspaceDir: string,
  taskId: string,
  inputFiles?: InputFileInfo[],
): Promise<OutboundMedia[]> {
  const manifestPaths = await readDeliverables(workspaceDir);
  if (manifestPaths) {
    const zip = await packageFilesAsZip(workspaceDir, taskId, manifestPaths);
    if (zip) {
      logger.info(
        `Using .deliverables manifest: ${manifestPaths.length} file(s) for task=${taskId}`,
      );
      return [zip];
    }
    logger.warn("Failed to package .deliverables entries as ZIP, trying auto-detect");
  }

  const detected = await autoDetectDeliverables(workspaceDir, inputFiles);
  if (detected.length > 0) {
    const zip = await packageFilesAsZip(workspaceDir, taskId, detected);
    if (zip) {
      logger.info(`Auto-detected ${detected.length} deliverable(s) for task=${taskId}`);
      return [zip];
    }
    logger.warn("Failed to package auto-detected deliverables as ZIP");
  }

  logger.info(`No deliverables detected for task=${taskId}; completion will have no attachments`);
  return [];
}

export async function autoDetectDeliverables(
  workspaceDir: string,
  inputFiles?: InputFileInfo[],
): Promise<string[]> {
  const buildOutputs = await detectBuildOutputFiles(workspaceDir);
  if (buildOutputs.length > 0) {
    logger.info(`Build output detection found ${buildOutputs.length} file(s)`);
    return buildOutputs;
  }

  const inputNames = new Set((inputFiles ?? []).map((f) => f.name));
  const allFiles = await listFilesRecursive(workspaceDir);
  const candidates: { path: string; ext: string; size: number }[] = [];

  for (const relativePath of allFiles) {
    const filename = path.basename(relativePath);
    if (inputNames.has(filename)) {
      continue;
    }
    if (NOISE_PATTERNS.some((re) => re.test(filename))) {
      continue;
    }

    const ext = path.extname(filename).toLowerCase().slice(1);
    const fullPath = path.join(workspaceDir, relativePath);
    try {
      const stat = await fs.stat(fullPath);
      candidates.push({ path: fullPath, ext, size: stat.size });
    } catch {
      continue;
    }
  }

  const deliverableFiles = candidates.filter((c) => DELIVERABLE_EXTENSIONS.has(c.ext));
  if (deliverableFiles.length > 0) {
    deliverableFiles.sort((a, b) => b.size - a.size);
    const selected = deliverableFiles.slice(0, 5);
    logger.info(
      `Auto-detect found ${deliverableFiles.length} deliverable file(s), selecting ${selected.length}`,
    );
    return selected.map((f) => f.path);
  }

  return [];
}

export function isManifestDeliverablePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized || normalized === ".") {
    return false;
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return false;
  }
  if (segments.some((segment) => BLOCKED_PATH_SEGMENTS.has(segment.toLowerCase()))) {
    return false;
  }

  const filename = path.basename(normalized).toLowerCase();
  if (MANIFEST_EXCLUDED_BASENAMES.has(filename)) {
    return false;
  }
  if (NOISE_PATTERNS.some((re) => re.test(path.basename(normalized)))) {
    return false;
  }
  return true;
}

export function selectProgressArtifacts(filesWritten: string[]): string[] {
  const selected = new Set<string>();
  for (const file of filesWritten) {
    if (selected.size >= 5) {
      break;
    }
    if (!isManifestDeliverablePath(file)) {
      continue;
    }
    const ext = path.extname(file).toLowerCase().slice(1);
    if (!PROGRESS_SUMMARY_EXTENSIONS.has(ext)) {
      continue;
    }
    selected.add(file);
  }
  return [...selected];
}

async function detectBuildOutputFiles(workspaceDir: string): Promise<string[]> {
  const discovered: string[] = [];
  for (const dirName of BUILD_OUTPUT_DIRS) {
    if (discovered.length >= MAX_BUILD_OUTPUT_FILES) {
      break;
    }
    const dirPath = path.join(workspaceDir, dirName);
    const files = await listFilesRecursively(dirPath, MAX_BUILD_OUTPUT_FILES - discovered.length);
    discovered.push(...files);
  }
  return discovered;
}

async function listFilesRecursively(dirPath: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (files.length >= maxFiles) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (BLOCKED_PATH_SEGMENTS.has(entry.name.toLowerCase())) {
          continue;
        }
        await walk(fullPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(dirPath);
  return files;
}

async function packageFilesAsZip(
  workspaceDir: string,
  taskId: string,
  filePaths: string[],
): Promise<OutboundMedia | undefined> {
  const relativePaths = [...new Set(filePaths.map((p) => path.relative(workspaceDir, p)))]
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => p.length > 0 && !p.startsWith("..") && !path.isAbsolute(p));

  if (relativePaths.length === 0) {
    return undefined;
  }

  try {
    const { execFileSync } = await import("node:child_process");
    const zipFilename = `${taskId}-artifacts.zip`;
    const zipPath = path.join(path.dirname(workspaceDir), zipFilename);
    execFileSync("zip", ["-r", zipPath, ...relativePaths], {
      cwd: workspaceDir,
      timeout: 60_000,
      stdio: "ignore",
    });
    const buffer = await fs.readFile(zipPath);
    await fs.unlink(zipPath).catch(() => {});
    return {
      type: "document",
      mimeType: "application/zip",
      buffer: new Uint8Array(buffer),
      filename: zipFilename,
    };
  } catch (err) {
    logger.warn(`Failed to package selected artifacts as ZIP: ${err}`);
    return undefined;
  }
}
