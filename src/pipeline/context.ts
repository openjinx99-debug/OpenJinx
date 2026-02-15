import type { ChannelId } from "../types/config.js";
import type { MsgContext, MediaAttachment } from "../types/messages.js";

export interface BuildContextParams {
  messageId: string;
  channel: ChannelId;
  text: string;
  senderId: string;
  senderName: string;
  accountId: string;
  isGroup: boolean;
  groupId?: string;
  groupName?: string;
  threadId?: string;
  media?: MediaAttachment[];
  raw?: unknown;
}

/**
 * Build a MsgContext from channel-specific data.
 */
export function buildMsgContext(params: BuildContextParams): MsgContext {
  const text = params.text.trim();
  const isCommand = text.startsWith("/");
  let commandName: string | undefined;
  let commandArgs: string | undefined;

  if (isCommand) {
    const spaceIdx = text.indexOf(" ");
    if (spaceIdx === -1) {
      commandName = text.slice(1);
      commandArgs = "";
    } else {
      commandName = text.slice(1, spaceIdx);
      commandArgs = text.slice(spaceIdx + 1).trim();
    }
  }

  const sessionKey = resolveSessionKey(params);

  return {
    messageId: params.messageId,
    channel: params.channel,
    sessionKey,
    agentId: "default",
    accountId: params.accountId,
    senderId: params.senderId,
    senderName: params.senderName,
    text,
    isGroup: params.isGroup,
    groupId: params.groupId,
    groupName: params.groupName,
    threadId: params.threadId,
    media: params.media,
    isCommand,
    commandName,
    commandArgs,
    timestamp: Date.now(),
    raw: params.raw,
  };
}

function resolveSessionKey(params: BuildContextParams): string {
  if (params.isGroup && params.groupId) {
    return `${params.channel}:group:${params.groupId}`;
  }
  return `${params.channel}:dm:${params.senderId}`;
}
