import type { JinxConfig } from "../types/config.js";
import type { MarathonControlPolicy } from "../types/marathon.js";

export interface MarathonControlPolicyInput {
  originSessionKey: string;
  channel: string;
  senderId?: string;
  groupId?: string;
}

export function extractGroupIdFromSessionKey(sessionKey: string): string | undefined {
  const parts = sessionKey.split(":");
  if (parts.length >= 3 && parts[1] === "group" && parts[2]) {
    return parts[2];
  }
  return undefined;
}

export function getChannelAllowlist(channel: string, config: JinxConfig): string[] {
  switch (channel) {
    case "terminal":
      return config.channels.terminal.allowFrom ?? [];
    case "telegram":
      return config.channels.telegram.allowFrom ?? [];
    case "whatsapp":
      return config.channels.whatsapp.allowFrom ?? [];
    default:
      return [];
  }
}

export function buildControlPolicy(
  params: MarathonControlPolicyInput,
  config: JinxConfig,
): MarathonControlPolicy {
  const originGroupId = params.groupId ?? extractGroupIdFromSessionKey(params.originSessionKey);
  const allowedSenderIds = new Set<string>();
  if (params.senderId) {
    allowedSenderIds.add(params.senderId);
  }
  for (const senderId of config.marathon.control.allowFrom) {
    allowedSenderIds.add(senderId);
  }
  for (const senderId of getChannelAllowlist(params.channel, config)) {
    allowedSenderIds.add(senderId);
  }

  return {
    ownerSenderId: params.senderId,
    originGroupId,
    allowedSenderIds: [...allowedSenderIds],
    allowSameGroupMembers: Boolean(originGroupId && config.marathon.control.allowSameGroupMembers),
  };
}
