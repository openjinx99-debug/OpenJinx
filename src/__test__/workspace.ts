import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Standard workspace file templates for test fixtures. */
const DEFAULT_FILES: Record<string, string> = {
  "SOUL.md": "# Soul\n\nYou are Jinx, a helpful AI assistant.\n",
  "AGENTS.md": "# Agents\n\n- default: Main agent\n",
  "IDENTITY.md": "# Identity\n\nName: Jinx\nVersion: test\n",
  "USER.md": "# User\n\nName: Test User\nPreferences: TypeScript, concise answers\n",
  "TOOLS.md": "# Tools\n\nAvailable tools listed below.\n",
  "HEARTBEAT.md": "# Heartbeat\n\n- [ ] Check weather forecast\n- [ ] Review calendar\n",
  "BOOTSTRAP.md": "# Bootstrap\n\nStartup instructions.\n",
  "MEMORY.md": "# Memory\n\nUser prefers dark mode.\nUser's timezone is America/New_York.\n",
};

export interface TestWorkspace {
  /** Root directory of the test workspace (identity files). */
  dir: string;
  /** Path to a task output subdirectory. */
  taskDir: string;
  /** Path to a pre-populated memory subdirectory. */
  memoryDir: string;
  /** Write a daily log file in memory/. */
  writeDailyLog: (date: string, content: string) => Promise<string>;
  /** Read a workspace file by name. */
  readFile: (name: string) => Promise<string>;
  /** Write or overwrite a workspace file. */
  writeFile: (name: string, content: string) => Promise<void>;
  /** Clean up the test workspace directory. */
  cleanup: () => Promise<void>;
}

/**
 * Create a temporary test workspace with pre-populated files.
 * Returns helpers for reading/writing files and a cleanup function.
 */
export async function createTestWorkspace(
  fileOverrides?: Record<string, string>,
): Promise<TestWorkspace> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jinx-test-ws-"));
  const taskDir = path.join(dir, "tasks");
  const memoryDir = path.join(dir, "memory");
  await fs.mkdir(taskDir, { recursive: true });
  await fs.mkdir(memoryDir, { recursive: true });

  // Write default workspace files
  const merged = { ...DEFAULT_FILES, ...fileOverrides };
  for (const [name, content] of Object.entries(merged)) {
    await fs.writeFile(path.join(dir, name), content, "utf-8");
  }

  // Write default memory files
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await fs.writeFile(
    path.join(memoryDir, `${yesterday}.md`),
    `# ${yesterday}\n\nYesterday's daily log.\n- Had a meeting about project X.\n- Fixed bug in auth module.\n`,
    "utf-8",
  );
  await fs.writeFile(
    path.join(memoryDir, `${today}.md`),
    `# ${today}\n\nToday's daily log.\n- Working on test infrastructure.\n`,
    "utf-8",
  );

  return {
    dir,
    taskDir,
    memoryDir,

    async writeDailyLog(date: string, content: string): Promise<string> {
      const filePath = path.join(memoryDir, `${date}.md`);
      await fs.writeFile(filePath, content, "utf-8");
      return filePath;
    },

    async readFile(name: string): Promise<string> {
      return fs.readFile(path.join(dir, name), "utf-8");
    },

    async writeFile(name: string, content: string): Promise<void> {
      const filePath = path.join(dir, name);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
    },

    async cleanup(): Promise<void> {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
