import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import type { CronJob } from "../types/cron.js";
import { CronStore } from "./store.js";

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: `job-${Math.random().toString(36).slice(2, 8)}`,
    name: "Test Job",
    schedule: { type: "every", intervalMs: 60_000 },
    payload: { prompt: "Run check", isolated: false },
    target: { agentId: "agent-1" },
    enabled: true,
    createdAt: Date.now(),
    nextRunAt: Date.now() + 60_000,
    failCount: 0,
    backoffMs: 0,
    ...overrides,
  };
}

describe("CronStore", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("adds, gets, and lists jobs", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-cron-"));
    const store = new CronStore(path.join(tmpDir, "cron.json"));

    const job = makeJob({ id: "job-1", name: "Check servers" });
    store.add(job);

    expect(store.get("job-1")).toEqual(job);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].name).toBe("Check servers");
  });

  it("removes a job by ID", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-cron-"));
    const store = new CronStore(path.join(tmpDir, "cron.json"));

    const job = makeJob({ id: "job-2" });
    store.add(job);

    expect(store.remove("job-2")).toBe(true);
    expect(store.get("job-2")).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });

  it("returns false when removing a nonexistent job", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-cron-"));
    const store = new CronStore(path.join(tmpDir, "cron.json"));
    expect(store.remove("nonexistent")).toBe(false);
  });

  it("updates a job in place", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-cron-"));
    const store = new CronStore(path.join(tmpDir, "cron.json"));

    const job = makeJob({ id: "job-3", name: "Original", failCount: 0 });
    store.add(job);

    store.update("job-3", { name: "Updated", failCount: 2 });

    const updated = store.get("job-3");
    expect(updated?.name).toBe("Updated");
    expect(updated?.failCount).toBe(2);
  });

  it("update is a no-op for nonexistent job", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-cron-"));
    const store = new CronStore(path.join(tmpDir, "cron.json"));

    // Should not throw
    store.update("nonexistent", { name: "Nope" });
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("saves and loads jobs from disk", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-cron-"));
    const filePath = path.join(tmpDir, "cron.json");

    const store1 = new CronStore(filePath);
    store1.add(makeJob({ id: "persist-1", name: "Persistent A" }));
    store1.add(makeJob({ id: "persist-2", name: "Persistent B" }));
    store1.save();

    const store2 = new CronStore(filePath);
    store2.load();

    expect(store2.list()).toHaveLength(2);
    expect(store2.get("persist-1")?.name).toBe("Persistent A");
    expect(store2.get("persist-2")?.name).toBe("Persistent B");
  });

  it("load starts fresh when file does not exist", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-cron-"));
    const store = new CronStore(path.join(tmpDir, "nonexistent.json"));

    store.load(); // Should not throw
    expect(store.list()).toHaveLength(0);
  });

  it("save creates intermediate directories", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-cron-"));
    const filePath = path.join(tmpDir, "nested", "dir", "cron.json");
    const store = new CronStore(filePath);

    store.add(makeJob({ id: "nested-job" }));
    store.save();

    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("saves files with secure permissions (0o600)", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jinx-cron-"));
    const filePath = path.join(tmpDir, "cron.json");
    const store = new CronStore(filePath);

    store.add(makeJob({ id: "perm-test" }));
    store.save();

    const stat = fs.statSync(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
