/**
 * Check if HEARTBEAT.md has actionable content worth sending to the LLM.
 *
 * Strips markdown headers, HTML comments, and empty list items.
 * Returns true only if real task items remain.
 */
export function hasActionableHeartbeatContent(content: string): boolean {
  const stripped = content
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, "")
    // Remove markdown headers
    .replace(/^#{1,6}\s+.*$/gm, "")
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // Remove empty list items (- , * , - [ ] , - [x] with nothing after)
    .replace(/^[\s]*[-*]\s*(\[[ x]?\])?\s*$/gm, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();

  return stripped.length > 0;
}
