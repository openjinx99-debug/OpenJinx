import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronService } from "./service.js";

describe("CronService", () => {
  let tmpDir: string;
  let runTurn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "jinx-cron-svc-"));
    runTurn = vi.fn(async () => "done");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createService(maxJobs = 10) {
    return new CronService({
      persistPath: path.join(tmpDir, "cron.json"),
      maxJobs,
      runTurn,
    });
  }

  it("add creates a job", () => {
    const service = createService();

    const job = service.add({
      name: "Check servers",
      schedule: { type: "every", intervalMs: 60_000 },
      payload: { prompt: "Run health check", isolated: false },
      target: { agentId: "agent-1" },
    });

    expect(job.id).toBeDefined();
    expect(job.name).toBe("Check servers");

    const jobs = service.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(job.id);
  });

  it("add respects maxJobs", () => {
    const service = createService(1);

    service.add({
      name: "Job 1",
      schedule: { type: "every", intervalMs: 60_000 },
      payload: { prompt: "Do thing", isolated: false },
      target: { agentId: "agent-1" },
    });

    expect(() =>
      service.add({
        name: "Job 2",
        schedule: { type: "every", intervalMs: 60_000 },
        payload: { prompt: "Do other thing", isolated: false },
        target: { agentId: "agent-1" },
      }),
    ).toThrow(/maximum cron jobs/i);
  });

  it("remove deletes a job", () => {
    const service = createService();

    const job = service.add({
      name: "Removable",
      schedule: { type: "every", intervalMs: 60_000 },
      payload: { prompt: "Remove me", isolated: false },
      target: { agentId: "agent-1" },
    });

    expect(service.list()).toHaveLength(1);

    const removed = service.remove(job.id);
    expect(removed).toBe(true);
    expect(service.list()).toHaveLength(0);
  });

  it("get returns job by id", () => {
    const service = createService();

    const job = service.add({
      name: "Findable",
      schedule: { type: "every", intervalMs: 30_000 },
      payload: { prompt: "Find me", isolated: false },
      target: { agentId: "agent-1" },
    });

    const found = service.get(job.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("Findable");
    expect(found!.id).toBe(job.id);
  });

  it("update patches a job", () => {
    const service = createService();

    const job = service.add({
      name: "Original Name",
      schedule: { type: "every", intervalMs: 60_000 },
      payload: { prompt: "Original prompt", isolated: false },
      target: { agentId: "agent-1" },
    });

    service.update(job.id, { name: "Updated Name" });

    const updated = service.get(job.id);
    expect(updated!.name).toBe("Updated Name");
    // Other fields should remain unchanged
    expect(updated!.payload.prompt).toBe("Original prompt");
  });

  it("run force-executes a job", async () => {
    const service = createService();

    const job = service.add({
      name: "Force Run",
      schedule: { type: "every", intervalMs: 60_000 },
      payload: { prompt: "Execute now", isolated: false },
      target: { agentId: "agent-1" },
    });

    await service.run(job.id);

    expect(runTurn).toHaveBeenCalledOnce();
    // runTurn now receives the full job object
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({ name: "Force Run" }));
  });

  it("start and stop don't throw", () => {
    const service = createService();

    expect(() => service.start()).not.toThrow();
    expect(() => service.stop()).not.toThrow();
  });
});
