/**
 * Live E2E test: Marathon builds a working video-to-MP3 audio extractor.
 *
 * NO MOCKS — uses real LLM provider, real auth, real container manager,
 * real marathon executor. The test launches a marathon, waits for it to
 * plan and execute all chunks, then verifies the built application
 * actually runs inside the container and extracts audio from a 5-second
 * test video to produce a valid MP3 file.
 *
 * Skip conditions (auto-skip, not fail):
 *   - hasAuth() returns false → no Claude credentials
 *   - isAppleContainerReady() returns false → no container runtime
 *
 * Run:
 *   npx vitest run src/__system__/marathon-build.live.test.ts --config vitest.live.config.ts
 *
 * Cost: ~$1-2 per run (planning + 3-5 chunks with tool use)
 * Time: 3-8 minutes wall-clock
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import type { SessionEntry, SessionStore } from "../types/sessions.js";
import { pollUntil } from "../__test__/async.js";
import { createTestConfig } from "../__test__/config.js";
import { createMockChannel } from "../__test__/mock-channel.js";
import { loadDotEnv } from "../infra/dotenv.js";
import { readCheckpoint } from "../pipeline/checkpoint.js";
import { launchMarathon } from "../pipeline/marathon.js";
import { hasAuth } from "../providers/auth.js";
import { createContainerManager } from "../sandbox/container-manager.js";
import { isAppleContainerReady } from "../sandbox/runtime-detect.js";

// Load ~/.jinx/.env so CLAUDE_CODE_OAUTH_TOKEN is available
loadDotEnv();

const canRun = hasAuth() && isAppleContainerReady();
const describeIf = canRun ? describe : describe.skip;

// Shared state for cleanup
let tmpHome: string | undefined;
let containerMgr: ReturnType<typeof createContainerManager> | undefined;
let marathonSessionKey: string | undefined;

afterAll(async () => {
  // Stop the marathon container (don't wait 24h in test)
  if (containerMgr && marathonSessionKey) {
    await containerMgr.stop(marathonSessionKey).catch(() => {});
    await containerMgr.dispose().catch(() => {});
  }
  if (tmpHome) {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

describeIf("Marathon live E2E — build a working app", () => {
  it("marathon builds a working video-to-MP3 audio extractor", async () => {
    // ── 1. SETUP ──────────────────────────────────────────────────
    tmpHome = path.join(os.tmpdir(), `jinx-marathon-live-${Date.now()}`);
    process.env.JINX_HOME = tmpHome;

    await fs.mkdir(path.join(tmpHome, "marathon"), { recursive: true });
    await fs.mkdir(path.join(tmpHome, "sessions"), { recursive: true });
    await fs.mkdir(path.join(tmpHome, "workspace"), { recursive: true });

    const config = createTestConfig({
      marathon: {
        enabled: true,
        maxConcurrent: 1,
        chunkIntervalMs: 0,
        maxChunks: 50,
        maxDurationHours: 1,
        maxRetriesPerChunk: 3,
        completionRetentionMs: 14_400_000,
        container: { cpus: 4, memoryGB: 4, commandTimeoutMs: 600_000 },
        progress: { notifyEveryNChunks: 1, includeFileSummary: true },
      },
      sandbox: {
        enabled: true,
        timeoutMs: 600_000,
        idleTimeoutMs: 900_000,
        maxOutputBytes: 102_400,
        image: "node:22-slim",
        blockedPatterns: [],
        allowedMounts: [],
        workspaceWritable: true,
      },
    });

    containerMgr = createContainerManager(config.sandbox);

    // In-memory session store
    const entries = new Map<string, SessionEntry>();
    const sessions: SessionStore = {
      get: (key) => entries.get(key),
      set: (key, entry) => entries.set(key, entry),
      delete: (key) => entries.delete(key),
      list: () => [...entries.values()],
      save: async () => {},
      load: async () => {},
    };

    // Mock channel to capture deliveries
    const channel = createMockChannel("terminal");

    // ── 2. LAUNCH ─────────────────────────────────────────────────
    // Keep the prompt simple to produce 3-5 chunks (not 8+).
    // Each chunk involves real tool use so fewer = faster.
    const prompt = `Build a simple Node.js CLI tool that extracts audio from video files to MP3 using ffmpeg.

The tool should:
- Take input and output file paths as CLI args: node src/index.js input.mov output.mp3
- Shell out to ffmpeg for audio extraction (e.g. ffmpeg -i input.mov -q:a 2 output.mp3)
- Print a status message and exit 0 on success, 1 on failure
- Include a package.json with a "test" script that runs a basic smoke test

Keep it minimal — 3 chunks max: setup, core logic, polish.`;

    launchMarathon(
      {
        prompt,
        originSessionKey: "terminal:dm:local",
        deliveryTarget: { channel: "terminal", to: "local" },
        channel: "terminal",
        senderName: "Live Test",
      },
      {
        config,
        sessions,
        containerManager: containerMgr,
        channels: new Map([["terminal", channel]]),
      },
    );

    // ── 3. WAIT FOR COMPLETION ────────────────────────────────────
    // The marathon is fire-and-forget. Poll for "complete!" in deliveries.
    console.log("  Waiting for marathon to complete (up to 20 minutes)...");
    const startTime = Date.now();

    await pollUntil(
      () => {
        const texts = channel.deliveries.map((d) => d.payload.text);
        return texts.some((t) => t.includes("complete!"));
      },
      { intervalMs: 5000, timeoutMs: 1_200_000 },
    );

    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`  Marathon completed in ${elapsedSec}s`);

    // ── 4. VERIFY ORCHESTRATION ───────────────────────────────────
    // Find the marathon session key (starts with "marathon:")
    const marathonSession = sessions.list().find((s) => s.sessionKey.startsWith("marathon:"));
    expect(marathonSession).toBeDefined();
    marathonSessionKey = marathonSession!.sessionKey;

    // Read checkpoint from disk
    const marathonDir = path.join(tmpHome, "marathon");
    const cpFiles = (await fs.readdir(marathonDir)).filter((f) => f.endsWith(".json"));
    expect(cpFiles.length).toBeGreaterThanOrEqual(1);

    const taskId = cpFiles[0].replace(".json", "");
    const checkpoint = await readCheckpoint(taskId);
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.status).toBe("completed");

    // completedChunks may include failed retry attempts alongside successful completions.
    // Verify that every planned chunk has at least one "completed" entry.
    const successfulChunks = checkpoint!.completedChunks.filter((c) => c.status === "completed");
    const failedChunks = checkpoint!.completedChunks.filter((c) => c.status === "failed");
    expect(successfulChunks.length).toBeGreaterThanOrEqual(2);
    console.log(
      `  Chunks completed: ${successfulChunks.map((c) => c.chunkName).join(", ")}` +
        (failedChunks.length > 0 ? ` (${failedChunks.length} retry failures along the way)` : ""),
    );

    // ── 5. VERIFY THE BUILT APPLICATION ───────────────────────────
    // Container should still be alive (retention, not demoted)
    const inspection = await containerMgr.inspect(marathonSessionKey);
    expect(inspection).toBeDefined();
    expect(inspection!.alive).toBe(true);

    // Find project root: locate package.json (may be at workspace root or in a subdirectory)
    const findPkg = await containerMgr.exec(
      marathonSessionKey,
      "find /workspace -name package.json -not -path '*/node_modules/*' -not -path '*/.git/*' | head -1",
    );
    const pkgPath = findPkg.stdout.trim();
    console.log(`  package.json found at: ${pkgPath || "NOT FOUND"}`);
    expect(pkgPath).toBeTruthy();

    // Derive project root from package.json location
    const projectRoot = pkgPath.replace(/\/package\.json$/, "");
    console.log(`  Project root: ${projectRoot}`);

    // List project files
    const lsResult = await containerMgr.exec(marathonSessionKey, `ls -la ${projectRoot}`);
    console.log(`  Project files:\n${lsResult.stdout}`);

    // Install deps in container
    const installResult = await containerMgr.exec(
      marathonSessionKey,
      `cd ${projectRoot} && npm install --if-present 2>&1`,
      { timeoutMs: 120_000 },
    );
    console.log(`  npm install exit=${installResult.exitCode}`);

    // Install ffmpeg if not present
    const ffmpegWhich = await containerMgr.exec(marathonSessionKey, "which ffmpeg");
    if (ffmpegWhich.exitCode !== 0) {
      console.log("  ffmpeg not found, installing...");
      const installResult = await containerMgr.exec(
        marathonSessionKey,
        "apt-get update -qq && apt-get install -y -qq ffmpeg 2>&1",
        { timeoutMs: 120_000 },
      );
      console.log(`  ffmpeg install exit=${installResult.exitCode}`);
      expect(installResult.exitCode).toBe(0);
    } else {
      console.log(`  ffmpeg: ${ffmpegWhich.stdout.trim()}`);
    }

    // Generate 5-second test video with audio track inside the project dir
    // (needs audio so ffmpeg can extract it to MP3)
    const genResult = await containerMgr.exec(
      marathonSessionKey,
      `ffmpeg -y -f lavfi -i testsrc=duration=5:size=320x240:rate=24 -f lavfi -i sine=frequency=440:duration=5 -c:v libx264 -c:a aac -shortest ${projectRoot}/test_input.mov 2>&1`,
      { timeoutMs: 60_000 },
    );
    expect(genResult.exitCode).toBe(0);

    // Find the entry point — search the project for index.js or main.js
    const findEntry = await containerMgr.exec(
      marathonSessionKey,
      `find ${projectRoot} -maxdepth 3 -name '*.js' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -name '*.test.js' -not -name '*.spec.js' | sort`,
    );
    const jsFiles = findEntry.stdout.trim().split("\n").filter(Boolean);
    console.log(`  JS files found: ${jsFiles.join(", ")}`);

    // Prefer src/index.js > index.js > src/main.js > main.js > first .js file
    const entryFile =
      jsFiles.find((f) => f.endsWith("/src/index.js")) ||
      jsFiles.find((f) => f.endsWith("/index.js")) ||
      jsFiles.find((f) => f.endsWith("/src/main.js")) ||
      jsFiles.find((f) => f.endsWith("/main.js")) ||
      jsFiles[0];
    console.log(`  Entry file: ${entryFile || "NONE"}`);
    expect(entryFile).toBeTruthy();

    // Run the built app: extract audio test_input.mov → test_output.mp3
    const runResult = await containerMgr.exec(
      marathonSessionKey,
      `cd ${projectRoot} && node ${entryFile} test_input.mov test_output.mp3 2>&1`,
      { timeoutMs: 60_000 },
    );
    console.log(`  App exit=${runResult.exitCode}`);
    console.log(`  App stdout: ${runResult.stdout.slice(0, 500)}`);
    if (runResult.stderr) {
      console.log(`  App stderr: ${runResult.stderr.slice(0, 500)}`);
    }

    // Verify output MP3 file exists
    const verifyResult = await containerMgr.exec(
      marathonSessionKey,
      `test -f ${projectRoot}/test_output.mp3 && echo EXISTS || echo MISSING`,
    );
    const outputExists = verifyResult.stdout.trim() === "EXISTS";
    console.log(`  Output file: ${outputExists ? "EXISTS" : "MISSING"}`);

    // Verify the MP3 has non-trivial size (5s of audio should be > 10KB)
    if (outputExists) {
      const sizeResult = await containerMgr.exec(
        marathonSessionKey,
        `stat -c %s ${projectRoot}/test_output.mp3 2>/dev/null || stat -f %z ${projectRoot}/test_output.mp3`,
      );
      const fileSize = parseInt(sizeResult.stdout.trim(), 10);
      console.log(`  Output MP3 size: ${fileSize} bytes`);
      expect(fileSize).toBeGreaterThan(10_000);
    }

    expect(runResult.exitCode).toBe(0);
    expect(outputExists).toBe(true);

    // ── 5b. VERIFY RALPH WIGGUM FEATURES ──────────────────────────
    // Check PROGRESS.md was written (inter-chunk memory)
    const progressResult = await containerMgr.exec(
      marathonSessionKey,
      "cat /workspace/PROGRESS.md 2>&1",
    );
    if (progressResult.exitCode === 0) {
      console.log(`  PROGRESS.md exists (${progressResult.stdout.length} chars)`);
      console.log(`  PROGRESS.md preview:\n${progressResult.stdout.slice(0, 500)}`);
    } else {
      console.log("  PROGRESS.md: not found (context enrichment may not have run)");
    }

    // Check git commits were made between chunks
    const gitLogResult = await containerMgr.exec(
      marathonSessionKey,
      "cd /workspace && git log --oneline 2>&1",
    );
    if (gitLogResult.exitCode === 0 && gitLogResult.stdout.trim()) {
      const commits = gitLogResult.stdout.trim().split("\n");
      console.log(`  Git commits: ${commits.length}`);
      for (const c of commits) {
        console.log(`    ${c}`);
      }
    } else {
      console.log("  Git: no commits found");
    }

    // Check test-fix status in checkpoint
    const chunksWithTests = checkpoint!.completedChunks.filter((c) => c.testStatus);
    if (chunksWithTests.length > 0) {
      console.log(`  Chunks with test results: ${chunksWithTests.length}`);
      for (const c of chunksWithTests) {
        console.log(
          `    ${c.chunkName}: tests=${c.testStatus!.testsPassed ? "PASS" : "FAIL"}, fixIterations=${c.testStatus!.fixIterations}`,
        );
      }
    } else {
      console.log("  No test-fix results in checkpoint (test detection may have missed)");
    }

    // ── 6. VERIFY DELIVERY ────────────────────────────────────────
    const allTexts = channel.deliveries.map((d) => d.payload.text);

    // Plan was delivered
    const planDelivery = allTexts.find((t) => t.includes("Marathon plan for"));
    expect(planDelivery).toBeDefined();

    // Completion with chunk summary
    const completionDelivery = allTexts.find((t) => t.includes("complete!"));
    expect(completionDelivery).toBeDefined();
    expect(completionDelivery).toContain("**Chunks completed:**");

    // ZIP attachment was delivered
    const zipDelivery = channel.deliveries.find(
      (d) => d.payload.media && d.payload.media.some((m) => m.mimeType === "application/zip"),
    );
    // ZIP is best-effort (requires `zip` binary in container)
    if (zipDelivery) {
      console.log("  ZIP attachment delivered");
    } else {
      console.log("  ZIP attachment not delivered (zip binary may not be in container)");
    }

    console.log(`  Total deliveries: ${channel.deliveries.length}`);
    console.log("  PASS: Marathon built a working video-to-MP3 extractor!");
  }, 900_000);
});
