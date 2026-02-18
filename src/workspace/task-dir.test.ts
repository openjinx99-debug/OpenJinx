import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureTaskDir, resolveTaskDir, resolveTasksRoot } from "./task-dir.js";

describe("resolveTasksRoot", () => {
  it("returns a path ending in /tasks", () => {
    const root = resolveTasksRoot();
    expect(root).toMatch(/\/tasks$/);
  });

  it("respects JINX_HOME env override", () => {
    const orig = process.env.JINX_HOME;
    process.env.JINX_HOME = "/custom/jinx";
    try {
      expect(resolveTasksRoot()).toBe("/custom/jinx/tasks");
    } finally {
      if (orig === undefined) {
        delete process.env.JINX_HOME;
      } else {
        process.env.JINX_HOME = orig;
      }
    }
  });
});

describe("resolveTaskDir", () => {
  it("creates a chat task dir with sanitized session key", () => {
    const dir = resolveTaskDir("chat", "telegram:dm:12345");
    expect(dir).toMatch(/\/tasks\/chat-telegram-dm-12345$/);
  });

  it("creates a deepwork task dir with short UUID", () => {
    const dir = resolveTaskDir("deepwork", "a1b2c3d4");
    expect(dir).toMatch(/\/tasks\/deepwork-a1b2c3d4$/);
  });

  it("creates a marathon task dir", () => {
    const dir = resolveTaskDir("marathon", "e5f6g7h8");
    expect(dir).toMatch(/\/tasks\/marathon-e5f6g7h8$/);
  });

  it("lowercases the ID", () => {
    const dir = resolveTaskDir("chat", "Telegram:DM:User1");
    expect(dir).toMatch(/\/tasks\/chat-telegram-dm-user1$/);
  });

  it("strips unsafe characters from ID", () => {
    const dir = resolveTaskDir("chat", "test/../../../etc/passwd");
    expect(dir).toMatch(/\/tasks\/chat-testetcpasswd$/);
  });

  it("preserves underscores and dashes in ID", () => {
    const dir = resolveTaskDir("deepwork", "my_task-id");
    expect(dir).toMatch(/\/tasks\/deepwork-my_task-id$/);
  });
});

describe("ensureTaskDir", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jinx-taskdir-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates the directory with secure permissions", async () => {
    const taskDir = path.join(tmpDir, "tasks", "chat-test");
    await ensureTaskDir(taskDir);

    const stat = await fs.stat(taskDir);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it("is idempotent — does not throw on existing dir", async () => {
    const taskDir = path.join(tmpDir, "tasks", "chat-test");
    await ensureTaskDir(taskDir);
    await ensureTaskDir(taskDir); // second call should not throw
    const stat = await fs.stat(taskDir);
    expect(stat.isDirectory()).toBe(true);
  });
});
