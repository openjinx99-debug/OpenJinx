/**
 * Check whether a Telegram chat is allowed to interact with the bot.
 */
export function checkTelegramAccess(params: {
  chatId: number;
  isGroup: boolean;
  dmPolicy: string;
  groupPolicy?: string;
  allowedChatIds?: number[];
}): boolean {
  const { chatId, isGroup, dmPolicy, groupPolicy, allowedChatIds } = params;

  // Groups
  if (isGroup) {
    // If groups are explicitly disabled, reject immediately
    if (groupPolicy === "disabled") {
      return false;
    }
    // Otherwise only if the chat ID is explicitly allowed
    if (!allowedChatIds || allowedChatIds.length === 0) {
      return false;
    }
    return allowedChatIds.includes(chatId);
  }

  // DMs
  switch (dmPolicy) {
    case "open":
      return true;
    case "allowlist":
      return allowedChatIds?.includes(chatId) ?? false;
    case "disabled":
      return false;
    default:
      return false;
  }
}
