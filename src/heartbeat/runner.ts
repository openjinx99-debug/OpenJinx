import type { JinxConfig } from "../types/config.js";
import type { HeartbeatAgentState, HeartbeatEvent, HeartbeatReason } from "../types/heartbeat.js";
import { createLogger } from "../infra/logger.js";
import { isWithinActiveHours } from "./active-hours.js";
import { isDuplicateHeartbeat, recordHeartbeatText } from "./duplicate.js";
import { isHeartbeatContentEffectivelyEmpty } from "./empty-check.js";
import { emitHeartbeatEvent } from "./events.js";
import { containsHeartbeatOk, stripHeartbeatOk } from "./heartbeat-ok.js";
import { selectHeartbeatPrompt } from "./prompts.js";

const logger = createLogger("heartbeat");

export class HeartbeatRunner {
  private agents = new Map<string, HeartbeatAgentState>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private config: JinxConfig,
    private runTurn: (agentId: string, prompt: string, reason: HeartbeatReason) => Promise<string>,
    private preFlightCheck?: (agentId: string) => Promise<boolean>,
    private isLaneBusy?: (agentId: string) => boolean,
  ) {}

  /** Register an agent for heartbeat monitoring. */
  registerAgent(
    agentId: string,
    intervalMs: number,
    activeHours?: HeartbeatAgentState["activeHours"],
  ): void {
    const now = Date.now();
    this.agents.set(agentId, {
      agentId,
      enabled: true,
      intervalMs,
      lastRunMs: 0,
      nextDueMs: now + intervalMs,
      running: false,
      consecutiveEmpty: 0,
      activeHours,
    });
  }

  /** Start the heartbeat timer loop. */
  start(): void {
    this.stopped = false;
    this.scheduleNext();
    logger.info(`Heartbeat runner started with ${this.agents.size} agents`);
  }

  /** Stop the heartbeat runner. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    logger.info("Heartbeat runner stopped");
  }

  /** Run a heartbeat for a specific agent. */
  async runOnce(agentId: string, reason: HeartbeatReason = "manual"): Promise<HeartbeatEvent> {
    const state = this.agents.get(agentId);
    if (!state) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    return this.executeHeartbeat(state, reason);
  }

  private scheduleNext(): void {
    if (this.stopped) {
      return;
    }

    const nextDue = this.findNextDue();
    if (!nextDue) {
      // Check again in 60s if no agents are due
      this.timer = setTimeout(() => this.tick(), 60_000);
      this.timer.unref();
      return;
    }

    const delayMs = Math.max(0, Math.min(nextDue - Date.now(), 60_000));
    this.timer = setTimeout(() => this.tick(), delayMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const now = Date.now();
    for (const state of this.agents.values()) {
      if (!state.enabled || state.running || now < state.nextDueMs) {
        continue;
      }

      // Check active hours
      if (state.activeHours && !isWithinActiveHours(state.activeHours)) {
        state.nextDueMs = now + state.intervalMs;
        continue;
      }

      try {
        await this.executeHeartbeat(state, "scheduled");
      } catch (err) {
        logger.error(`Heartbeat tick failed for ${state.agentId}`, err);
        state.nextDueMs = Date.now() + state.intervalMs;
      }
    }

    this.scheduleNext();
  }

  private async executeHeartbeat(
    state: HeartbeatAgentState,
    reason: HeartbeatReason = "manual",
  ): Promise<HeartbeatEvent> {
    const start = Date.now();

    // Lane-busy check: defer heartbeat if user conversation is active
    if (this.isLaneBusy?.(state.agentId)) {
      logger.debug(`Lane busy: deferring heartbeat for ${state.agentId}`);
      state.nextDueMs = Date.now() + state.intervalMs;

      const event: HeartbeatEvent = {
        type: "heartbeat",
        agentId: state.agentId,
        timestamp: start,
        hasContent: false,
        wasOk: true,
        durationMs: Date.now() - start,
      };
      emitHeartbeatEvent(event);
      return event;
    }

    state.running = true;

    try {
      // Pre-flight check: skip API call if nothing actionable
      // Event-triggered heartbeats always proceed — they have events to deliver
      const isEventReason = reason === "cron-event" || reason === "exec-event";
      if (this.preFlightCheck && !isEventReason) {
        const shouldRun = await this.preFlightCheck(state.agentId);
        if (!shouldRun) {
          logger.debug(`Pre-flight check: skipping heartbeat for ${state.agentId}`);
          state.lastRunMs = start;
          state.nextDueMs = Date.now() + state.intervalMs;
          state.consecutiveEmpty++;

          const event: HeartbeatEvent = {
            type: "heartbeat",
            agentId: state.agentId,
            timestamp: start,
            hasContent: false,
            wasOk: true,
            durationMs: Date.now() - start,
          };
          emitHeartbeatEvent(event);
          return event;
        }
      }

      const prompt = selectHeartbeatPrompt(reason, this.config.timezone);
      const responseText = await this.runTurn(state.agentId, prompt, reason);
      const wasOk = containsHeartbeatOk(responseText);
      const cleaned = stripHeartbeatOk(responseText);
      const isEmpty = isHeartbeatContentEffectivelyEmpty(cleaned);
      const hasContent = !isEmpty && cleaned.length > 0;

      // Update state
      state.lastRunMs = start;
      state.nextDueMs = Date.now() + state.intervalMs;
      state.consecutiveEmpty = hasContent ? 0 : state.consecutiveEmpty + 1;

      // Duplicate suppression
      if (hasContent && isDuplicateHeartbeat(state.agentId, cleaned)) {
        logger.debug(`Suppressed duplicate heartbeat for ${state.agentId}`);
        const event: HeartbeatEvent = {
          type: "heartbeat",
          agentId: state.agentId,
          timestamp: start,
          hasContent: false,
          wasOk: true,
          durationMs: Date.now() - start,
        };
        emitHeartbeatEvent(event);
        return event;
      }

      if (hasContent) {
        recordHeartbeatText(state.agentId, cleaned);
      }

      const event: HeartbeatEvent = {
        type: "heartbeat",
        agentId: state.agentId,
        timestamp: start,
        hasContent,
        text: hasContent ? cleaned : undefined,
        wasOk,
        durationMs: Date.now() - start,
      };

      emitHeartbeatEvent(event);
      return event;
    } catch (err) {
      logger.error(`Heartbeat execution failed for ${state.agentId}`, err);

      state.lastRunMs = start;
      state.nextDueMs = Date.now() + state.intervalMs;

      const failedEvent: HeartbeatEvent = {
        type: "heartbeat",
        agentId: state.agentId,
        timestamp: start,
        hasContent: false,
        wasOk: false,
        durationMs: Date.now() - start,
      };
      emitHeartbeatEvent(failedEvent);
      return failedEvent;
    } finally {
      state.running = false;
    }
  }

  private findNextDue(): number | undefined {
    let earliest: number | undefined;
    for (const state of this.agents.values()) {
      if (!state.enabled || state.running) {
        continue;
      }
      if (earliest === undefined || state.nextDueMs < earliest) {
        earliest = state.nextDueMs;
      }
    }
    return earliest;
  }
}
