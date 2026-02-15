/**
 * Check if a heartbeat response is too short to be worth delivering.
 * Short responses are typically acknowledgments ("All clear", "Nothing needed"),
 * not real alerts or proactive content.
 */
export function isAcknowledgment(text: string, maxChars = 300): boolean {
  return text.length < maxChars;
}
