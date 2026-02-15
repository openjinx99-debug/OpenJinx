import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { getDailyLogPath, appendDailyLog } from "./daily-logs.js";

describe("getDailyLogPath", () => {
  it("returns a path with today's date", () => {
    const result = getDailyLogPath("/tmp/memory");
    const today = new Date().toISOString().slice(0, 10);
    expect(result).toBe(`/tmp/memory/${today}.md`);
  });

  it("expands tilde in the directory path", () => {
    const result = getDailyLogPath("~/jinx-memory");
    const home = os.homedir();
    const today = new Date().toISOString().slice(0, 10);
    expect(result).toBe(path.join(home, `jinx-memory/${today}.md`));
  });

  it("handles absolute paths without tilde", () => {
    const result = getDailyLogPath("/var/data/logs");
    const today = new Date().toISOString().slice(0, 10);
    expect(result).toBe(`/var/data/logs/${today}.md`);
  });
});

describe("appendDailyLog", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates the directory and log file if they do not exist", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-daily-log-"));
    const memoryDir = path.join(tmpDir, "nested", "memory");

    await appendDailyLog(memoryDir, "Test entry");

    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join(memoryDir, `${today}.md`);
    expect(fs.existsSync(logPath)).toBe(true);

    const content = await fsp.readFile(logPath, "utf-8");
    expect(content).toContain(`# Daily Log`);
    expect(content).toContain("Test entry");
  });

  it("appends to an existing log file", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-daily-log-"));

    await appendDailyLog(tmpDir, "First entry");
    await appendDailyLog(tmpDir, "Second entry");

    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join(tmpDir, `${today}.md`);
    const content = await fsp.readFile(logPath, "utf-8");

    expect(content).toContain("First entry");
    expect(content).toContain("Second entry");
    // Header should only appear once
    const headerMatches = content.match(/# Daily Log/g);
    expect(headerMatches).toHaveLength(1);
  });

  it("includes timestamp in each entry", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-daily-log-"));

    await appendDailyLog(tmpDir, "Timed entry");

    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join(tmpDir, `${today}.md`);
    const content = await fsp.readFile(logPath, "utf-8");

    // Should contain a time pattern like [HH:MM:SS]
    expect(content).toMatch(/- \[\d{2}:\d{2}:\d{2}\] Timed entry/);
  });

  it("creates header with the correct date", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-daily-log-"));

    await appendDailyLog(tmpDir, "entry");

    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join(tmpDir, `${today}.md`);
    const content = await fsp.readFile(logPath, "utf-8");

    expect(content).toContain(`# Daily Log \u2014 ${today}`);
  });
});
