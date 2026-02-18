import type { MsgContext, ReplyPayload } from "../types/messages.js";
import type { MarathonControlPolicy } from "../types/marathon.js";
import type { DispatchDeps } from "./dispatch.js";
import { createLogger } from "../infra/logger.js";
import { logProductTelemetry } from "../infra/product-telemetry.js";
import { readCheckpoint, listCheckpoints, pauseCheckpoint } from "./checkpoint.js";
import { resumeMarathon, cancelMarathon } from "./marathon.js";

const logger = createLogger("marathon-commands");

/**
 * Handle /marathon subcommands: status, pause, resume, cancel, logs.
 * Authorization: verify originSessionKey matches requester's channel+userId.
 */
export async function handleMarathonCommand(
  ctx: MsgContext,
  deps: DispatchDeps,
): Promise<ReplyPayload> {
  const args = (ctx.commandArgs ?? "").trim().split(/\s+/);
  const subcommand = args[0]?.toLowerCase();
  const taskId = args[1];

  emitControlTelemetry("marathon_control_requested", ctx, subcommand, taskId);

  switch (subcommand) {
    case "status":
      return handleStatus(ctx, deps);
    case "pause":
      return handlePause(ctx, taskId, deps);
    case "resume":
      return handleResume(ctx, taskId, deps);
    case "cancel":
      return handleCancel(ctx, taskId, deps);
    case "logs":
      return handleLogs(ctx, taskId, deps);
    default:
      emitControlTelemetry("marathon_control_invalid", ctx, subcommand, taskId);
      return {
        text:
          "Usage: `/marathon <command> [taskId]`\n\n" +
          "Commands:\n" +
          "- `status` — list active marathons\n" +
          "- `pause <taskId>` — pause a running marathon\n" +
          "- `resume <taskId>` — resume a paused marathon\n" +
          "- `cancel <taskId>` — cancel a marathon\n" +
          "- `logs <taskId>` — show chunk execution history",
      };
  }
}

function matchesOrigin(
  originSessionKey: string,
  ctx: MsgContext,
  deps: DispatchDeps,
  originSenderId?: string,
  controlPolicy?: MarathonControlPolicy,
): boolean {
  if (controlPolicy) {
    return matchesControlPolicy(originSessionKey, ctx, controlPolicy);
  }

  // Extract channel:type:userId pattern from origin
  // Group sessions: by default only the starter can control, and only from the same group.
  const originParts = originSessionKey.split(":");
  const ctxPrefix = `${ctx.channel}:`;
  if (originSessionKey.startsWith(ctxPrefix)) {
    // DM: exact userId match
    if (originParts[1] === "dm") {
      return originSessionKey === `${ctx.channel}:dm:${ctx.senderId}`;
    }
    // Group: only messages from the same group can control.
    if (originParts[1] === "group" && ctx.isGroup) {
      const originGroupId = originParts[2];
      const ctxGroupId = ctx.groupId ?? ctx.sessionKey.split(":")[2];
      const sameGroup = Boolean(originGroupId && ctxGroupId && originGroupId === ctxGroupId);
      if (!sameGroup) {
        return false;
      }
      if (originSenderId) {
        return originSenderId === ctx.senderId || isMarathonControlAllowlisted(ctx, deps);
      }
      return true;
    }
  }
  // Terminal sessions match all
  if (originSessionKey.startsWith("terminal:")) {
    return ctx.channel === "terminal";
  }
  return false;
}

function matchesControlPolicy(
  originSessionKey: string,
  ctx: MsgContext,
  controlPolicy: MarathonControlPolicy,
): boolean {
  if (originSessionKey.startsWith("terminal:")) {
    return ctx.channel === "terminal";
  }

  const ctxPrefix = `${ctx.channel}:`;
  if (!originSessionKey.startsWith(ctxPrefix)) {
    return false;
  }

  if (controlPolicy.allowedSenderIds.includes(ctx.senderId)) {
    return true;
  }
  if (controlPolicy.ownerSenderId && controlPolicy.ownerSenderId === ctx.senderId) {
    return true;
  }

  if (controlPolicy.originGroupId) {
    if (!ctx.isGroup) {
      return false;
    }
    const ctxGroupId = ctx.groupId ?? ctx.sessionKey.split(":")[2];
    const sameGroup =
      Boolean(ctxGroupId) && Boolean(controlPolicy.originGroupId) && ctxGroupId === controlPolicy.originGroupId;
    if (!sameGroup) {
      return false;
    }
    if (controlPolicy.allowSameGroupMembers) {
      return true;
    }
    return false;
  }

  return false;
}

function isMarathonControlAllowlisted(ctx: MsgContext, deps: DispatchDeps): boolean {
  switch (ctx.channel) {
    case "terminal":
      return deps.config.channels.terminal.allowFrom?.includes(ctx.senderId) ?? false;
    case "telegram":
      return deps.config.channels.telegram.allowFrom?.includes(ctx.senderId) ?? false;
    case "whatsapp":
      return deps.config.channels.whatsapp.allowFrom?.includes(ctx.senderId) ?? false;
    default:
      return false;
  }
}

async function handleStatus(ctx: MsgContext, deps: DispatchDeps): Promise<ReplyPayload> {
  const all = await listCheckpoints();
  const userCheckpoints = all.filter((cp) =>
    matchesOrigin(cp.originSessionKey, ctx, deps, cp.originSenderId, cp.controlPolicy),
  );

  if (userCheckpoints.length === 0) {
    emitControlTelemetry("marathon_control_success", ctx, "status", undefined, { visibleTasks: 0 });
    return { text: "No active marathons." };
  }

  const lines = userCheckpoints.map((cp) => {
    const progress = `${cp.currentChunkIndex}/${cp.plan.chunks.length}`;
    return `- \`${cp.taskId}\` [${cp.status}] ${progress} chunks — ${cp.plan.goal}`;
  });

  emitControlTelemetry("marathon_control_success", ctx, "status", undefined, {
    visibleTasks: userCheckpoints.length,
  });
  return { text: `Active marathons:\n\n${lines.join("\n")}` };
}

async function handlePause(
  ctx: MsgContext,
  taskId: string | undefined,
  deps: DispatchDeps,
): Promise<ReplyPayload> {
  if (!taskId) {
    emitControlTelemetry("marathon_control_invalid", ctx, "pause", undefined, { reason: "missing-task-id" });
    return { text: "Usage: `/marathon pause <taskId>`" };
  }
  const cp = await readCheckpoint(taskId);
  if (!cp) {
    emitControlTelemetry("marathon_control_not_found", ctx, "pause", taskId);
    return { text: `Marathon not found: \`${taskId}\`` };
  }
  if (!matchesOrigin(cp.originSessionKey, ctx, deps, cp.originSenderId, cp.controlPolicy)) {
    logger.warn(
      `Marathon pause denied: task=${taskId} requester=${ctx.sessionKey} origin=${cp.originSessionKey}`,
    );
    emitControlTelemetry("marathon_control_denied", ctx, "pause", taskId, {
      originSessionKey: cp.originSessionKey,
      originSenderId: cp.originSenderId,
      scopedPolicyApplied: Boolean(cp.controlPolicy),
      allowlistedController: isMarathonControlAllowlisted(ctx, deps),
    });
    return { text: "Access denied: this marathon was started from a different session." };
  }
  await pauseCheckpoint(taskId);
  emitControlTelemetry("marathon_control_success", ctx, "pause", taskId);
  return { text: `Marathon \`${taskId}\` paused.` };
}

async function handleResume(
  ctx: MsgContext,
  taskId: string | undefined,
  deps: DispatchDeps,
): Promise<ReplyPayload> {
  if (!taskId) {
    emitControlTelemetry("marathon_control_invalid", ctx, "resume", undefined, {
      reason: "missing-task-id",
    });
    return { text: "Usage: `/marathon resume <taskId>`" };
  }
  const cp = await readCheckpoint(taskId);
  if (!cp) {
    emitControlTelemetry("marathon_control_not_found", ctx, "resume", taskId);
    return { text: `Marathon not found: \`${taskId}\`` };
  }
  if (!matchesOrigin(cp.originSessionKey, ctx, deps, cp.originSenderId, cp.controlPolicy)) {
    logger.warn(
      `Marathon resume denied: task=${taskId} requester=${ctx.sessionKey} origin=${cp.originSessionKey}`,
    );
    emitControlTelemetry("marathon_control_denied", ctx, "resume", taskId, {
      originSessionKey: cp.originSessionKey,
      originSenderId: cp.originSenderId,
      scopedPolicyApplied: Boolean(cp.controlPolicy),
      allowlistedController: isMarathonControlAllowlisted(ctx, deps),
    });
    return { text: "Access denied: this marathon was started from a different session." };
  }
  try {
    await resumeMarathon(taskId, deps);
    emitControlTelemetry("marathon_control_success", ctx, "resume", taskId);
    return { text: `Marathon \`${taskId}\` resumed.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitControlTelemetry("marathon_control_failed", ctx, "resume", taskId, { error: msg });
    return { text: `Failed to resume: ${msg}` };
  }
}

async function handleCancel(
  ctx: MsgContext,
  taskId: string | undefined,
  deps: DispatchDeps,
): Promise<ReplyPayload> {
  if (!taskId) {
    emitControlTelemetry("marathon_control_invalid", ctx, "cancel", undefined, {
      reason: "missing-task-id",
    });
    return { text: "Usage: `/marathon cancel <taskId>`" };
  }
  const cp = await readCheckpoint(taskId);
  if (!cp) {
    emitControlTelemetry("marathon_control_not_found", ctx, "cancel", taskId);
    return { text: `Marathon not found: \`${taskId}\`` };
  }
  if (!matchesOrigin(cp.originSessionKey, ctx, deps, cp.originSenderId, cp.controlPolicy)) {
    logger.warn(
      `Marathon cancel denied: task=${taskId} requester=${ctx.sessionKey} origin=${cp.originSessionKey}`,
    );
    emitControlTelemetry("marathon_control_denied", ctx, "cancel", taskId, {
      originSessionKey: cp.originSessionKey,
      originSenderId: cp.originSenderId,
      scopedPolicyApplied: Boolean(cp.controlPolicy),
      allowlistedController: isMarathonControlAllowlisted(ctx, deps),
    });
    return { text: "Access denied: this marathon was started from a different session." };
  }
  try {
    await cancelMarathon(taskId, deps);
    emitControlTelemetry("marathon_control_success", ctx, "cancel", taskId);
    return { text: `Marathon \`${taskId}\` cancelled.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitControlTelemetry("marathon_control_failed", ctx, "cancel", taskId, { error: msg });
    return { text: `Failed to cancel: ${msg}` };
  }
}

async function handleLogs(
  ctx: MsgContext,
  taskId: string | undefined,
  deps: DispatchDeps,
): Promise<ReplyPayload> {
  if (!taskId) {
    emitControlTelemetry("marathon_control_invalid", ctx, "logs", undefined, { reason: "missing-task-id" });
    return { text: "Usage: `/marathon logs <taskId>`" };
  }
  const cp = await readCheckpoint(taskId);
  if (!cp) {
    emitControlTelemetry("marathon_control_not_found", ctx, "logs", taskId);
    return { text: `Marathon not found: \`${taskId}\`` };
  }
  if (!matchesOrigin(cp.originSessionKey, ctx, deps, cp.originSenderId, cp.controlPolicy)) {
    logger.warn(
      `Marathon logs denied: task=${taskId} requester=${ctx.sessionKey} origin=${cp.originSessionKey}`,
    );
    emitControlTelemetry("marathon_control_denied", ctx, "logs", taskId, {
      originSessionKey: cp.originSessionKey,
      originSenderId: cp.originSenderId,
      scopedPolicyApplied: Boolean(cp.controlPolicy),
      allowlistedController: isMarathonControlAllowlisted(ctx, deps),
    });
    return { text: "Access denied: this marathon was started from a different session." };
  }

  if (cp.completedChunks.length === 0) {
    emitControlTelemetry("marathon_control_success", ctx, "logs", taskId, { completedChunks: 0 });
    return { text: `Marathon \`${taskId}\` — no chunks completed yet.` };
  }

  const lines = cp.completedChunks.map((chunk, i) => {
    const duration = Math.round(chunk.durationMs / 1000);
    const status = chunk.status === "completed" ? "done" : chunk.status;
    return `${i + 1}. **${chunk.chunkName}** [${status}] ${duration}s${chunk.lastError ? ` — ${chunk.lastError}` : ""}`;
  });

  emitControlTelemetry("marathon_control_success", ctx, "logs", taskId, {
    completedChunks: cp.completedChunks.length,
  });
  return {
    text: `Marathon \`${taskId}\` logs:\n\n${lines.join("\n")}\n\nCurrent: chunk ${cp.currentChunkIndex + 1}/${cp.plan.chunks.length} [${cp.status}]`,
  };
}

function emitControlTelemetry(
  event: string,
  ctx: MsgContext,
  command: string | undefined,
  taskId: string | undefined,
  metadata?: Record<string, unknown>,
): void {
  logProductTelemetry({
    area: "marathon",
    event,
    command: command ?? "unknown",
    taskId: taskId ?? null,
    requesterChannel: ctx.channel,
    requesterSessionKey: ctx.sessionKey,
    requesterSenderId: ctx.senderId,
    requesterIsGroup: ctx.isGroup,
    requesterGroupId: ctx.groupId,
    ...metadata,
  });
}
