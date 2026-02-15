/**
 * Check if heartbeat content is effectively empty.
 * Strips whitespace, markdown formatting, and common filler phrases.
 */
export function isHeartbeatContentEffectivelyEmpty(text: string): boolean {
  const stripped = text
    .replace(/HEARTBEAT_OK/g, "")
    .replace(/[#*_`~[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped.length === 0) {
    return true;
  }
  if (stripped.length < 10) {
    return true;
  }

  // Common filler phrases that indicate no real content
  const fillerPatterns = [
    /^all (is )?clear\.?$/i,
    /^nothing to report\.?$/i,
    /^no (new )?items?\.?$/i,
    /^everything (is )?(ok|fine|good)\.?$/i,
    /^no action (needed|required)\.?$/i,
  ];

  return fillerPatterns.some((p) => p.test(stripped));
}
