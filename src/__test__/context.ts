import type { ChannelId } from "../types/config.js";
import type { MsgContext } from "../types/messages.js";

interface MsgContextOverrides {
  messageId?: string;
  channel?: ChannelId;
  sessionKey?: string;
  agentId?: string;
  accountId?: string;
  senderId?: string;
  senderName?: string;
  text?: string;
  isGroup?: boolean;
  groupId?: string;
  groupName?: string;
  threadId?: string;
  isCommand?: boolean;
  commandName?: string;
  commandArgs?: string;
  timestamp?: number;
}

/**
 * Build a MsgContext with sensible defaults. Override any field via `overrides`.
 */
export function buildTestMsgContext(overrides: MsgContextOverrides = {}): MsgContext {
  const channel = overrides.channel ?? "telegram";
  const senderId = overrides.senderId ?? "user-test-123";
  const isGroup = overrides.isGroup ?? false;
  const groupId = overrides.groupId;

  const sessionKey =
    overrides.sessionKey ??
    (isGroup && groupId ? `${channel}:group:${groupId}` : `${channel}:dm:${senderId}`);

  const text = overrides.text ?? "Hello, Jinx!";
  const isCommand = overrides.isCommand ?? text.startsWith("/");

  return {
    messageId: overrides.messageId ?? `msg-${Date.now()}`,
    channel,
    sessionKey,
    agentId: overrides.agentId ?? "default",
    accountId: overrides.accountId ?? "bot-test-456",
    senderId,
    senderName: overrides.senderName ?? "Test User",
    text,
    isGroup,
    groupId,
    groupName: overrides.groupName,
    threadId: overrides.threadId,
    isCommand,
    commandName: overrides.commandName,
    commandArgs: overrides.commandArgs,
    timestamp: overrides.timestamp ?? Date.now(),
  };
}
