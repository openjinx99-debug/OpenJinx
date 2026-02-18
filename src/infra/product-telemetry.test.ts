import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProductTelemetryPath,
  logProductTelemetry,
  readProductTelemetry,
} from "./product-telemetry.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? "/tmp", "product-telemetry-test-"));
  vi.stubEnv("JINX_HOME", tmpDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("logProductTelemetry", () => {
  it("writes JSONL entries to product telemetry file", () => {
    logProductTelemetry({
      area: "marathon",
      event: "marathon_launch_requested",
      taskId: "marathon-abc",
    });

    const content = fs.readFileSync(getProductTelemetryPath(), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]) as { area: string; event: string; taskId: string };
    expect(parsed.area).toBe("marathon");
    expect(parsed.event).toBe("marathon_launch_requested");
    expect(parsed.taskId).toBe("marathon-abc");
  });

  it("preserves caller-provided timestamp", () => {
    logProductTelemetry({
      timestamp: 1234,
      area: "marathon",
      event: "marathon_chunk_started",
      chunkName: "setup",
    });

    const content = fs.readFileSync(getProductTelemetryPath(), "utf-8");
    const parsed = JSON.parse(content.trim()) as { timestamp: number };
    expect(parsed.timestamp).toBe(1234);
  });

  it("skips writes in test mode when JINX_HOME is not set", () => {
    const appendSpy = vi.spyOn(fs, "appendFileSync");
    vi.unstubAllEnvs();

    logProductTelemetry({
      area: "marathon",
      event: "marathon_launch_requested",
      taskId: "marathon-skip",
    });

    expect(appendSpy).not.toHaveBeenCalled();

    appendSpy.mockRestore();
    vi.stubEnv("JINX_HOME", tmpDir);
  });
});

describe("readProductTelemetry", () => {
  it("returns empty array when telemetry file does not exist", async () => {
    const events = await readProductTelemetry();
    expect(events).toEqual([]);
  });

  it("filters entries by since timestamp", async () => {
    logProductTelemetry({ timestamp: 1000, area: "marathon", event: "a" });
    logProductTelemetry({ timestamp: 2000, area: "marathon", event: "b" });
    logProductTelemetry({ timestamp: 3000, area: "marathon", event: "c" });

    const events = await readProductTelemetry(2000);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("b");
    expect(events[1].event).toBe("c");
  });

  it("skips malformed lines safely", async () => {
    fs.writeFileSync(
      getProductTelemetryPath(),
      '{"timestamp":1,"area":"marathon","event":"ok"}\nnot-json\n{"timestamp":2,"area":"marathon","event":"ok2"}\n',
    );

    const events = await readProductTelemetry();
    expect(events).toHaveLength(2);
  });
});
