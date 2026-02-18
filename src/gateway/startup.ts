import fsPromises from "node:fs/promises";
import path from "node:path";
import type { ChannelPlugin } from "../types/channels.js";
import type { JinxConfig } from "../types/config.js";
import type { SessionStore } from "../types/sessions.js";
import { runAgent } from "../agents/runner.js";
import { createTelegramChannel } from "../channels/telegram/bot.js";
import { createWhatsAppChannel } from "../channels/whatsapp/bot.js";
import { startTriggerSubscriber } from "../composio/trigger-subscriber.js";
import { CronService } from "../cron/service.js";
import { deliverWithRetryAndFallback } from "../delivery/reliable.js";
import { prependSystemEvents } from "../events/consumption.js";
import { createEventQueue } from "../events/queue.js";
import { deliverHeartbeatEvent } from "../heartbeat/delivery.js";
import { setPersistentDuplicateStore } from "../heartbeat/duplicate.js";
import { onHeartbeatEvent } from "../heartbeat/events.js";
import { hasActionableHeartbeatContent } from "../heartbeat/preflight.js";
import { selectHeartbeatPrompt } from "../heartbeat/prompts.js";
import { HeartbeatRunner } from "../heartbeat/runner.js";
import { resolveVisibility } from "../heartbeat/visibility.js";
import { onHeartbeatWake, cancelAllWakes, requestHeartbeatNow } from "../heartbeat/wake.js";
import { expandTilde, resolveHomeDir } from "../infra/home-dir.js";
import { createLogger, setLogLevel, suppressSensitiveLogs } from "../infra/logger.js";
import { SECURE_DIR_MODE } from "../infra/security.js";
import { createOpenAIEmbeddingProvider } from "../memory/embeddings.js";
import { MemorySearchManager } from "../memory/search-manager.js";
import { listCheckpoints, readCheckpoint } from "../pipeline/checkpoint.js";
import { getSessionLane } from "../pipeline/lanes.js";
import { isExecutorAlive, resumeMarathon } from "../pipeline/marathon.js";
import { createContainerManager } from "../sandbox/container-manager.js";
import { SessionReaper } from "../sessions/reaper.js";
import { createSessionStore } from "../sessions/store.js";
import { resolveTranscriptPath } from "../sessions/transcript.js";
import { startSkillRefresh } from "../skills/refresh.js";
import { ensureWorkspace } from "../workspace/bootstrap.js";
import { resolveTasksRoot } from "../workspace/task-dir.js";
import { handleMarathonWatchdogJob } from "./marathon-watchdog.js";
import { createHttpServer } from "./server-http.js";
import { createGatewayServer } from "./server.js";

const logger = createLogger("startup");

export interface BootResult {
  stop: () => Promise<void>;
  sessions: SessionStore;
  config: JinxConfig;
  channels: Map<string, ChannelPlugin>;
  searchManager: MemorySearchManager;
}

/**
 * Boot the Jinx gateway with all subsystems.
 *
 * Boot sequence:
 *   1. Load + validate config
 *   2. Initialize workspace
 *   3. Initialize session store
 *   4. Start heartbeat runner
 *   5. Start cron service
 *   6. Start gateway WebSocket server
 *   7. Report ready
 */
export async function bootGateway(config: JinxConfig): Promise<BootResult> {
  setLogLevel(config.logging.level);
  suppressSensitiveLogs();
  logger.info("Booting Jinx gateway...");

  const homeDir = resolveHomeDir();

  // 1. Ensure workspace files exist
  const workspaceDir = path.join(homeDir, "workspace");
  await ensureWorkspace(workspaceDir);
  logger.info("Workspace initialized");

  // 1a. Ensure task output root exists
  await fsPromises.mkdir(resolveTasksRoot(), { recursive: true, mode: SECURE_DIR_MODE });
  logger.info("Tasks directory initialized");

  // 1b. Ensure memory directory exists
  const memoryDir = expandTilde(config.memory.dir);
  await fsPromises.mkdir(memoryDir, { recursive: true, mode: SECURE_DIR_MODE });
  logger.info("Memory directory initialized");

  // 1c. Create memory search manager (with optional embeddings)
  const openaiKey = process.env.OPENAI_API_KEY;
  let searchManager: MemorySearchManager;

  if (openaiKey) {
    const embeddings = createOpenAIEmbeddingProvider({
      apiKey: openaiKey,
      model: config.memory.embeddingModel,
    });
    searchManager = new MemorySearchManager(config.memory, embeddings);
    logger.info("Memory search with embeddings enabled");
  } else {
    searchManager = new MemorySearchManager(config.memory);
    logger.info("Memory search enabled (BM25 only — set OPENAI_API_KEY for vector search)");
  }

  // Load persisted index from disk (avoids full re-embedding on restart)
  await searchManager.init();

  // 1d. Create container manager for sandbox (if enabled)
  let containerManager: ReturnType<typeof createContainerManager> | undefined;
  if (config.sandbox.enabled) {
    const { isAppleContainerReady, describeRuntime } = await import("../sandbox/runtime-detect.js");
    if (isAppleContainerReady()) {
      containerManager = createContainerManager(config.sandbox);
      logger.info("Container manager initialized (persistent Apple Container sessions)");
    } else {
      logger.warn(
        `Sandbox enabled but container runtime not ready. ${describeRuntime(false)} ` +
          "Agent exec tool will be unavailable.",
      );
    }
  }

  // 1e. Resume active marathon tasks (scan checkpoints, exclude from orphan cleanup)
  if (containerManager) {
    const activeCheckpoints = await listCheckpoints({ status: ["executing", "paused"] });
    if (activeCheckpoints.length > 0) {
      const excludeIds = activeCheckpoints.map((cp) => cp.containerId);
      await containerManager.cleanupOrphans(excludeIds);
      logger.info(
        `Found ${activeCheckpoints.length} active marathon checkpoint(s), excluded from orphan cleanup`,
      );
    }
  }

  // 2. Initialize session store
  const sessions = createSessionStore();
  await sessions.load();
  logger.info("Session store loaded");

  // 2b. Wire persistent duplicate detection via session store
  setPersistentDuplicateStore({
    getLast(agentId) {
      const sessionKey = `heartbeat:${agentId}`;
      const session = sessions.get(sessionKey);
      if (session?.lastHeartbeatText && session.lastHeartbeatSentAt) {
        return { text: session.lastHeartbeatText, timestamp: session.lastHeartbeatSentAt };
      }
      return undefined;
    },
    setLast(agentId, text, timestamp) {
      const sessionKey = `heartbeat:${agentId}`;
      const session = sessions.get(sessionKey);
      if (session) {
        session.lastHeartbeatText = text;
        session.lastHeartbeatSentAt = timestamp;
      }
    },
  });
  logger.info("Persistent duplicate detection wired");

  // 3. Start heartbeat runner + cron service
  //    Both reference each other's closures (heartbeat uses cron tools, cron enqueues to heartbeat).
  //    Both closures only execute after boot, so late-binding via `let` is safe.
  const eventQueue = createEventQueue({
    persistPath: path.join(homeDir, "events-queue.json"),
  });
  let cron: CronService;

  const heartbeat = new HeartbeatRunner(
    config,
    async (agentId, prompt, reason) => {
      const heartbeatSessionKey = `heartbeat:${agentId}`;
      const transcriptPath = resolveTranscriptPath(heartbeatSessionKey);

      // Defensive: if event-based reason but queue is empty, override to default prompt
      const isEventReason =
        reason === "cron-event" || reason === "exec-event" || reason === "composio-trigger";
      const hasEvents = eventQueue.count(heartbeatSessionKey) > 0;
      const effectivePrompt =
        isEventReason && !hasEvents
          ? selectHeartbeatPrompt(reason, config.timezone, false)
          : prompt;

      // Prepend any pending system events to the prompt
      const enrichedPrompt = prependSystemEvents(eventQueue, heartbeatSessionKey, effectivePrompt);

      const result = await runAgent({
        prompt: enrichedPrompt,
        sessionKey: heartbeatSessionKey,
        sessionType: "main",
        tier: "light",
        transcriptPath,
        config,
        searchManager,
        cronService: cron,
        containerManager,
      });

      return result.text;
    },
    async (agentId) => {
      const heartbeatSessionKey = `heartbeat:${agentId}`;

      // Check for pending system events
      if (eventQueue.count(heartbeatSessionKey) > 0) {
        return true;
      }

      // Check HEARTBEAT.md for actionable content
      const heartbeatPath = path.join(workspaceDir, "HEARTBEAT.md");
      try {
        const content = await fsPromises.readFile(heartbeatPath, "utf-8");
        return hasActionableHeartbeatContent(content);
      } catch {
        return false;
      }
    },
    // Lane-busy check: suppress heartbeat when user conversation is active
    (agentId) => {
      const lane = getSessionLane(`heartbeat:${agentId}`);
      return lane.running > 0 || lane.pending > 0;
    },
  );

  // Register agents for heartbeat
  for (const agent of config.agents.list) {
    const hbConfig = agent.heartbeat;
    const enabled = hbConfig?.enabled ?? config.heartbeat.enabled;

    if (enabled) {
      const intervalMs =
        (hbConfig?.intervalMinutes ?? config.heartbeat.defaultIntervalMinutes) * 60_000;
      heartbeat.registerAgent(agent.id, intervalMs, hbConfig?.activeHours);
      logger.info(`Registered agent ${agent.id} for heartbeat (interval=${intervalMs}ms)`);
    }
  }

  heartbeat.start();
  logger.info("Heartbeat runner started");

  // Register wake callback so requestHeartbeatNow() triggers a real heartbeat
  onHeartbeatWake(async (agentId, reason) => {
    try {
      await heartbeat.runOnce(agentId, reason);
      return { status: "ok" };
    } catch (err) {
      logger.warn(`Heartbeat wake failed for ${agentId}: ${err}`);
      return { status: "skipped", reason: String(err) };
    }
  });

  // Subscribe to heartbeat events for multi-channel delivery
  const visibility = resolveVisibility(config.heartbeat.visibility);

  // Channel registry (populated after channels start, closures read it lazily)
  const channels = new Map<string, ChannelPlugin>();

  const unsubHeartbeat = onHeartbeatEvent((event) => {
    deliverHeartbeatEvent(event, {
      sessions,
      visibility,
      getChannel: (name) => channels.get(name),
    });
  });

  // 4. Start cron service
  const cronPath = path.join(homeDir, "cron.json");
  cron = new CronService({
    persistPath: cronPath,
    maxJobs: config.cron.maxJobs,
    runTurn: async (job) => {
      const agentId = job.target.agentId || config.agents.default;
      const ts = Date.now();

      const watchdogResult = await handleMarathonWatchdogJob(job, {
        isExecutorAlive,
        removeJob: (jobId) => cron.remove(jobId),
        readCheckpoint,
        resume: async (taskId) => {
          await resumeMarathon(taskId, {
            config,
            sessions,
            cronService: cron,
            channels,
            containerManager,
            searchManager,
          });
        },
        logger,
      });
      if (watchdogResult) {
        return watchdogResult;
      }

      if (job.payload.isolated) {
        // Isolated: run in a dedicated cron session
        const cronSessionKey = `cron:${agentId}:${ts}`;
        const transcriptPath = resolveTranscriptPath(cronSessionKey);

        // Tell the agent its output will be auto-delivered so it doesn't
        // try to send messages itself or complain about missing credentials.
        const deliveryNote = job.target.deliverTo
          ? `\n\n[System: This is a scheduled cron job. Your entire response will be automatically delivered to ${job.target.deliverTo.channel}. Do NOT try to send messages yourself — just produce the content directly. Do not mention delivery, credentials, or how to send the message.]`
          : "";

        const result = await runAgent({
          prompt: job.payload.prompt + deliveryNote,
          sessionKey: cronSessionKey,
          sessionType: "subagent",
          tier: "light",
          transcriptPath,
          config,
          searchManager,
          cronService: cron,
          containerManager,
        });

        // Deliver result to the originating channel if available,
        // otherwise fall back to heartbeat delivery path
        const text = `⏰ [${job.name}] ${result.text}`;
        if (job.target.deliverTo) {
          await deliverWithRetryAndFallback({
            payload: { text },
            target: job.target.deliverTo,
            deps: { getChannel: (name) => channels.get(name) },
            source: "cron",
            reason: "isolated-cron",
            taskId: job.id,
            maxAttempts: 3,
            retryBaseMs: 100,
            retryMaxMs: 800,
            terminalText: text,
            emitFallback: (_sessionKey, fallbackText) => {
              logger.warn(
                `Cron "${job.name}": delivery failed on ${job.target.deliverTo!.channel}, falling back to heartbeat delivery`,
              );
              deliverHeartbeatEvent(
                {
                  type: "heartbeat",
                  agentId,
                  timestamp: ts,
                  hasContent: true,
                  text: fallbackText,
                  wasOk: false,
                  durationMs: Date.now() - ts,
                },
                {
                  sessions,
                  visibility: { showOk: false, showAlerts: true, useIndicator: false },
                  getChannel: (name) => channels.get(name),
                },
              );
            },
          });
        } else {
          deliverHeartbeatEvent(
            {
              type: "heartbeat",
              agentId,
              timestamp: ts,
              hasContent: true,
              text,
              wasOk: false,
              durationMs: Date.now() - ts,
            },
            {
              sessions,
              visibility: { showOk: false, showAlerts: true, useIndicator: false },
              getChannel: (name) => channels.get(name),
            },
          );
        }

        return result.text;
      } else {
        // Non-isolated: enqueue to heartbeat session and wake immediately
        const heartbeatSessionKey = `heartbeat:${agentId}`;
        eventQueue.enqueue(
          `[Cron: ${job.name}] ${job.payload.prompt}`,
          heartbeatSessionKey,
          "cron",
        );
        requestHeartbeatNow(agentId, "cron-event");
        return "enqueued";
      }
    },
  });
  cron.start();
  logger.info("Cron service started");

  // 4b. Start Composio trigger subscriber (if enabled)
  let stopTriggers: (() => Promise<void>) | undefined;
  const composioApiKey = config.composio.apiKey || process.env.COMPOSIO_API_KEY;
  if (config.composio.enabled && composioApiKey) {
    stopTriggers = await startTriggerSubscriber({
      eventQueue,
      defaultAgentId: config.agents.default,
      apiKey: composioApiKey,
      userId: config.composio.userId,
      timeoutSeconds: config.composio.timeoutSeconds,
      requestHeartbeatNow,
    });
  }

  // 5. Start gateway server
  const gateway = createGatewayServer(config, {
    config,
    sessions,
    searchManager,
    cronService: cron,
    channels,
    containerManager,
  });
  gateway.start();

  // 5b. Start HTTP server (if enabled)
  const httpServer = config.gateway.http?.enabled
    ? createHttpServer({ config, sessions, startedAt: Date.now() })
    : undefined;

  if (httpServer) {
    httpServer.start();
    logger.info("HTTP server started");
  }

  // 6. Start Telegram channel (if configured)
  let telegramChannel: ChannelPlugin | undefined;
  const telegramCfg = config.channels.telegram;
  if (telegramCfg.enabled) {
    if (telegramCfg.botToken) {
      telegramChannel = createTelegramChannel(telegramCfg, {
        config,
        sessions,
        searchManager,
        cronService: cron,
        channels,
        containerManager,
      });
      await telegramChannel.start();
      channels.set(telegramChannel.id, telegramChannel);

      // Wire Telegram webhook to HTTP server
      if (telegramCfg.mode === "webhook" && httpServer && telegramChannel.handleWebhookRequest) {
        const telegramHandler = telegramChannel.handleWebhookRequest.bind(telegramChannel);
        httpServer.onWebhook(async (path, body, headers) => {
          if (path === "telegram/webhook") {
            return telegramHandler(body, headers);
          }
          return { status: 404, body: JSON.stringify({ error: "Not found" }) };
        });
        logger.info("Telegram webhook wired to HTTP server");
      }

      logger.info("Telegram channel started");
    } else {
      logger.warn("Telegram enabled but no botToken configured — skipping");
    }
  }

  // 6b. Start WhatsApp channel (if configured)
  let whatsappChannel: ChannelPlugin | undefined;
  const whatsappCfg = config.channels.whatsapp;
  if (whatsappCfg.enabled) {
    whatsappChannel = createWhatsAppChannel(whatsappCfg, {
      config,
      sessions,
      searchManager,
      cronService: cron,
      channels,
      containerManager,
    });
    await whatsappChannel.start();
    channels.set(whatsappChannel.id, whatsappChannel);
    logger.info("WhatsApp channel started");
  }

  // 6c. Start session reaper for ephemeral sessions (cron + deep work + marathon)
  const reaper = new SessionReaper(sessions, { prefixes: ["cron:", "deepwork:", "marathon:"] });
  reaper.start();

  // 6c.5. Resume active marathon tasks (after all deps are wired)
  if (containerManager) {
    const marathonCheckpoints = await listCheckpoints({ status: ["executing"] });
    for (const cp of marathonCheckpoints) {
      logger.info(`Resuming marathon task=${cp.taskId} from chunk ${cp.currentChunkIndex}`);
      resumeMarathon(cp.taskId, {
        config,
        sessions,
        cronService: cron,
        channels,
        containerManager,
        searchManager,
      }).catch((err) => {
        logger.warn(`Marathon resume failed for ${cp.taskId}: ${err}`);
      });
    }
  }

  // 6d. Start skill hot-reload watcher
  const stopSkillRefresh = startSkillRefresh(config.skills.dirs, (skills) => {
    logger.debug(`Skills refreshed: ${skills.length} skills loaded`);
  });

  logger.info("Jinx gateway ready");

  // 7. Validate memory wiring (lessons-learned #16, #17)
  const wiredPaths: string[] = ["gateway"];
  if (telegramChannel) {
    wiredPaths.push("telegram");
  }
  if (whatsappChannel) {
    wiredPaths.push("whatsapp");
  }
  wiredPaths.push("heartbeat");
  logger.info(`Memory search wired to: ${wiredPaths.join(", ")}`);

  const status = searchManager.getStatus();
  if (status.totalChunks === 0) {
    logger.warn("Memory index empty — search will return no results until files are added");
  } else {
    logger.info(`Memory index: ${status.totalFiles} files, ${status.totalChunks} chunks`);
  }

  return {
    sessions,
    config,
    channels,
    searchManager,
    async stop() {
      logger.info("Shutting down...");

      const SHUTDOWN_TIMEOUT_MS = 10_000;

      const shutdown = async () => {
        // Stop in reverse order
        stopSkillRefresh();
        reaper.stop();
        if (stopTriggers) {
          await stopTriggers();
        }
        if (whatsappChannel) {
          await whatsappChannel.stop();
        }
        if (telegramChannel) {
          await telegramChannel.stop();
        }
        unsubHeartbeat();
        cron.stop();
        cancelAllWakes();
        heartbeat.stop();
        if (httpServer) {
          await httpServer.stop();
        }
        await gateway.stop();
        if (containerManager) {
          await containerManager.dispose();
        }
        await sessions.save();
      };

      // Race shutdown against a timeout to prevent hanging
      const timeout = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms`));
        }, SHUTDOWN_TIMEOUT_MS);
        timer.unref();
      });

      try {
        await Promise.race([shutdown(), timeout]);
        logger.info("Shutdown complete");
      } catch (err) {
        logger.error(`Shutdown error: ${err}`);
        logger.warn("Force-exiting due to shutdown timeout");
        process.exit(1);
      }
    },
  };
}
