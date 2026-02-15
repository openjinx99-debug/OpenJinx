/**
 * Check whether a WhatsApp JID is allowed to interact with the bot.
 */
export function checkWhatsAppAccess(params: {
  jid: string;
  isGroup: boolean;
  dmPolicy: string;
  groupPolicy?: string;
  allowFrom?: string[];
}): boolean {
  const { jid, isGroup, dmPolicy, groupPolicy, allowFrom } = params;

  if (isGroup) {
    if (groupPolicy === "disabled") {
      return false;
    }
    if (!allowFrom || allowFrom.length === 0) {
      return true;
    } // groups enabled, no filter
    return allowFrom.includes(jid);
  }

  // DMs
  switch (dmPolicy) {
    case "open":
      return true;
    case "allowlist":
      return allowFrom?.includes(jid) ?? false;
    case "disabled":
      return false;
    default:
      return false;
  }
}
