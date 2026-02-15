import fs from "node:fs/promises";
import path from "node:path";
import { expandTilde } from "../infra/home-dir.js";
import { appendDailyLog } from "./daily-logs.js";

/**
 * Hook called when a session ends (e.g., /new command).
 * Generates a slug and writes a summary to memory.
 */
export async function onSessionEnd(params: {
  memoryDir: string;
  sessionKey: string;
  slug: string;
  summary: string;
}): Promise<string> {
  const { memoryDir, sessionKey, slug, summary } = params;
  const dir = expandTilde(memoryDir);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}-${slug}.md`;
  const filePath = path.join(dir, filename);

  await fs.mkdir(dir, { recursive: true });

  const content = [`# ${slug}`, "", `Session: ${sessionKey}`, `Date: ${date}`, "", summary].join(
    "\n",
  );

  await fs.writeFile(filePath, content, "utf-8");

  // Also log to daily log
  await appendDailyLog(memoryDir, `Session ended: ${slug}`);

  return filePath;
}
