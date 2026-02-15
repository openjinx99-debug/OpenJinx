import fs from "node:fs/promises";
import path from "node:path";
import { expandTilde } from "../infra/home-dir.js";
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from "../infra/security.js";

/**
 * Get the path for today's daily log file.
 */
export function getDailyLogPath(memoryDir: string): string {
  const dir = expandTilde(memoryDir);
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(dir, `${date}.md`);
}

/**
 * Append an entry to today's daily log.
 */
export async function appendDailyLog(memoryDir: string, entry: string): Promise<void> {
  const logPath = getDailyLogPath(memoryDir);
  await fs.mkdir(path.dirname(logPath), { recursive: true, mode: SECURE_DIR_MODE });

  const time = new Date().toISOString().slice(11, 19);
  const line = `\n- [${time}] ${entry}\n`;

  try {
    await fs.access(logPath);
  } catch {
    // Create new daily log with header
    const date = new Date().toISOString().slice(0, 10);
    const header = `# Daily Log — ${date}\n`;
    await fs.writeFile(logPath, header, { encoding: "utf-8", mode: SECURE_FILE_MODE });
  }

  await fs.appendFile(logPath, line, "utf-8");
}
