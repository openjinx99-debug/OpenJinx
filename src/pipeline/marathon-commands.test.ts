import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MsgContext } from "../types/messages.js";
import { createTestConfig } from "../__test__/config.js";

// Mock dependencies
vi.mock("./checkpoint.js", () => ({
  readCheckpoint: vi.fn(),
  listCheckpoints: vi.fn(),
  pauseCheckpoint: vi.fn(),
  resolveMarathonDir: vi.fn().mockReturnValue("/tmp/marathon"),
}));

vi.mock("./marathon.js", () => ({
  resumeMarathon: vi.fn(),
  cancelMarathon: vi.fn(),
}));

vi.mock("../infra/product-telemetry.js", () => ({
  logProductTelemetry: vi.fn(),
}));

vi.mock("../infra/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockReadCheckpoint = vi.fn();
const mockListCheckpoints = vi.fn();
const mockPauseCheckpoint = vi.fn();
const mockResumeMarathon = vi.fn();
const mockCancelMarathon = vi.fn();
const mockLogProductTelemetry = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  const cp = await import("./checkpoint.js");
  vi.mocked(cp.readCheckpoint).mockImplementation(mockReadCheckpoint);
  vi.mocked(cp.listCheckpoints).mockImplementation(mockListCheckpoints);
  vi.mocked(cp.pauseCheckpoint).mockImplementation(mockPauseCheckpoint);

  const marathon = await import("./marathon.js");
  vi.mocked(marathon.resumeMarathon).mockImplementation(mockResumeMarathon);
  vi.mocked(marathon.cancelMarathon).mockImplementation(mockCancelMarathon);

  const telemetry = await import("../infra/product-telemetry.js");
  vi.mocked(telemetry.logProductTelemetry).mockImplementation(mockLogProductTelemetry);
});

const { handleMarathonCommand } = await import("./marathon-commands.js");

const sampleCheckpoint = {
  taskId: "marathon-abc12345",
  sessionKey: "marathon:abc12345",
  containerId: "jinx-marathon-abc12345",
  status: "executing" as const,
  plan: {
    goal: "Build a todo app",
    chunks: [
      { name: "scaffold", prompt: "Create project structure", estimatedMinutes: 5 },
      { name: "api", prompt: "Build REST API", estimatedMinutes: 10 },
    ],
  },
  currentChunkIndex: 1,
  completedChunks: [
    {
      chunkName: "scaffold",
      status: "completed" as const,
      summary: "Created project",
      filesWritten: ["package.json"],
      durationMs: 30000,
      completedAt: Date.now(),
      failedAttempts: 0,
    },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deliverTo: { channel: "telegram" as const, to: "user123" },
  workspaceDir: "/tmp/tasks/marathon-abc12345",
  originSessionKey: "telegram:dm:user123",
  maxRetriesPerChunk: 3,
};

function makeCtx(overrides?: Partial<MsgContext>): MsgContext {
  return {
    messageId: "msg-1",
    sessionKey: "telegram:dm:user123",
    text: "/marathon status",
    channel: "telegram",
    accountId: "bot",
    senderId: "user123",
    senderName: "Test User",
    isGroup: false,
    isCommand: true,
    commandName: "marathon",
    commandArgs: "status",
    agentId: "default",
    timestamp: Date.now(),
    ...overrides,
  };
}

const deps = {
  config: createTestConfig(),
  sessions: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    save: vi.fn(),
    load: vi.fn(),
  },
};

describe("handleMarathonCommand", () => {
  it("/marathon status lists active marathons for requesting user", async () => {
    mockListCheckpoints.mockResolvedValue([sampleCheckpoint]);

    const result = await handleMarathonCommand(makeCtx(), deps);
    expect(result.text).toContain("marathon-abc12345");
    expect(result.text).toContain("executing");
  });

  it("/marathon status shows 'no active marathons' when empty", async () => {
    mockListCheckpoints.mockResolvedValue([]);

    const result = await handleMarathonCommand(makeCtx(), deps);
    expect(result.text).toContain("No active marathons");
  });

  it("/marathon pause sets checkpoint to paused", async () => {
    mockReadCheckpoint.mockResolvedValue(sampleCheckpoint);
    mockPauseCheckpoint.mockResolvedValue(undefined);

    const result = await handleMarathonCommand(
      makeCtx({ commandArgs: "pause marathon-abc12345" }),
      deps,
    );
    expect(result.text).toContain("paused");
    expect(mockPauseCheckpoint).toHaveBeenCalledWith("marathon-abc12345");
    expect(mockLogProductTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        area: "marathon",
        event: "marathon_control_success",
        command: "pause",
      }),
    );
  });

  it("/marathon resume restarts paused marathon", async () => {
    mockReadCheckpoint.mockResolvedValue({ ...sampleCheckpoint, status: "paused" });
    mockResumeMarathon.mockResolvedValue(undefined);

    const result = await handleMarathonCommand(
      makeCtx({ commandArgs: "resume marathon-abc12345" }),
      deps,
    );
    expect(result.text).toContain("resumed");
    expect(mockResumeMarathon).toHaveBeenCalledWith("marathon-abc12345", deps);
  });

  it("/marathon cancel destroys container and marks cancelled", async () => {
    mockReadCheckpoint.mockResolvedValue(sampleCheckpoint);
    mockCancelMarathon.mockResolvedValue(undefined);

    const result = await handleMarathonCommand(
      makeCtx({ commandArgs: "cancel marathon-abc12345" }),
      deps,
    );
    expect(result.text).toContain("cancelled");
    expect(mockCancelMarathon).toHaveBeenCalledWith("marathon-abc12345", deps);
  });

  it("/marathon logs shows chunk execution history", async () => {
    mockReadCheckpoint.mockResolvedValue(sampleCheckpoint);

    const result = await handleMarathonCommand(
      makeCtx({ commandArgs: "logs marathon-abc12345" }),
      deps,
    );
    expect(result.text).toContain("scaffold");
    expect(result.text).toContain("done");
    expect(result.text).toContain("2/2");
  });

  it("commands from different user are denied (authorization check)", async () => {
    // Checkpoint originated from telegram:dm:user123, but requester is user456
    mockReadCheckpoint.mockResolvedValue(sampleCheckpoint);

    const result = await handleMarathonCommand(
      makeCtx({
        senderId: "user456",
        sessionKey: "telegram:dm:user456",
        commandArgs: "pause marathon-abc12345",
      }),
      deps,
    );
    expect(result.text).toContain("Access denied");
    expect(mockLogProductTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        area: "marathon",
        event: "marathon_control_denied",
        command: "pause",
      }),
    );
  });

  it("group commands from a different group are denied", async () => {
    mockReadCheckpoint.mockResolvedValue({
      ...sampleCheckpoint,
      originSessionKey: "telegram:group:group-123",
    });

    const result = await handleMarathonCommand(
      makeCtx({
        isGroup: true,
        groupId: "group-456",
        sessionKey: "telegram:group:group-456",
        commandArgs: "pause marathon-abc12345",
      }),
      deps,
    );

    expect(result.text).toContain("Access denied");
  });

  it("group commands from same group but different sender are denied when owner is recorded", async () => {
    mockReadCheckpoint.mockResolvedValue({
      ...sampleCheckpoint,
      originSessionKey: "telegram:group:group-123",
      originSenderId: "owner-1",
    });

    const result = await handleMarathonCommand(
      makeCtx({
        isGroup: true,
        senderId: "other-user",
        groupId: "group-123",
        sessionKey: "telegram:group:group-123",
        commandArgs: "pause marathon-abc12345",
      }),
      deps,
    );

    expect(result.text).toContain("Access denied");
  });

  it("group commands allow configured control allowlist even when sender is not owner", async () => {
    mockReadCheckpoint.mockResolvedValue({
      ...sampleCheckpoint,
      originSessionKey: "telegram:group:group-123",
      originSenderId: "owner-1",
    });

    const allowlistedDeps = {
      ...deps,
      config: createTestConfig({
        channels: {
          telegram: {
            allowFrom: ["maintainer-1"],
          },
        },
      }),
    };

    const result = await handleMarathonCommand(
      makeCtx({
        isGroup: true,
        senderId: "maintainer-1",
        groupId: "group-123",
        sessionKey: "telegram:group:group-123",
        commandArgs: "pause marathon-abc12345",
      }),
      allowlistedDeps,
    );

    expect(result.text).toContain("paused");
    expect(mockPauseCheckpoint).toHaveBeenCalledWith("marathon-abc12345");
  });

  it("group commands allow same-group members when checkpoint control policy permits it", async () => {
    mockReadCheckpoint.mockResolvedValue({
      ...sampleCheckpoint,
      originSessionKey: "telegram:group:group-123",
      originSenderId: "owner-1",
      controlPolicy: {
        ownerSenderId: "owner-1",
        originGroupId: "group-123",
        allowedSenderIds: ["owner-1"],
        allowSameGroupMembers: true,
      },
    });

    const result = await handleMarathonCommand(
      makeCtx({
        isGroup: true,
        senderId: "teammate-2",
        groupId: "group-123",
        sessionKey: "telegram:group:group-123",
        commandArgs: "pause marathon-abc12345",
      }),
      deps,
    );

    expect(result.text).toContain("paused");
    expect(mockPauseCheckpoint).toHaveBeenCalledWith("marathon-abc12345");
  });

  it("checkpoint-scoped policy denies controller not in task ACL even if channel allowlist currently allows", async () => {
    mockReadCheckpoint.mockResolvedValue({
      ...sampleCheckpoint,
      originSessionKey: "telegram:group:group-123",
      originSenderId: "owner-1",
      controlPolicy: {
        ownerSenderId: "owner-1",
        originGroupId: "group-123",
        allowedSenderIds: ["owner-1"],
        allowSameGroupMembers: false,
      },
    });

    const allowlistedDeps = {
      ...deps,
      config: createTestConfig({
        channels: {
          telegram: {
            allowFrom: ["maintainer-1"],
          },
        },
      }),
    };

    const result = await handleMarathonCommand(
      makeCtx({
        isGroup: true,
        senderId: "maintainer-1",
        groupId: "group-123",
        sessionKey: "telegram:group:group-123",
        commandArgs: "pause marathon-abc12345",
      }),
      allowlistedDeps,
    );

    expect(result.text).toContain("Access denied");
    expect(mockPauseCheckpoint).not.toHaveBeenCalled();
  });

  it("/marathon with no subcommand shows usage help", async () => {
    const result = await handleMarathonCommand(makeCtx({ commandArgs: "" }), deps);
    expect(result.text).toContain("Usage");
    expect(result.text).toContain("status");
    expect(result.text).toContain("pause");
    expect(result.text).toContain("resume");
    expect(result.text).toContain("cancel");
    expect(result.text).toContain("logs");
  });
});
