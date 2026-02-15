/**
 * Normalize a phone number to E.164 format.
 * Strips all non-digit characters and ensures a leading +.
 */
export function normalizePhoneNumber(phone: string): string {
  // Remove everything except digits and leading +
  let digits = phone.replace(/[^\d+]/g, "");

  // If there's a +, keep it; otherwise add one
  if (!digits.startsWith("+")) {
    digits = `+${digits}`;
  }

  // Remove any non-digit characters after the +
  const cleaned = `+${digits.slice(1).replace(/\D/g, "")}`;

  return cleaned;
}

/**
 * Check whether a string is a valid WhatsApp JID.
 * Valid forms: 1234567890@s.whatsapp.net  or  1234567890-1234567890@g.us
 */
export function isValidJid(jid: string): boolean {
  if (!jid) {
    return false;
  }

  // Individual chat JID
  if (jid.endsWith("@s.whatsapp.net")) {
    const num = jid.slice(0, -"@s.whatsapp.net".length);
    return /^\d{7,15}$/.test(num);
  }

  // Group JID
  if (jid.endsWith("@g.us")) {
    const groupPart = jid.slice(0, -"@g.us".length);
    return /^\d+-\d+$/.test(groupPart);
  }

  return false;
}
