const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";

/**
 * Check if a response contains the HEARTBEAT_OK token.
 */
export function containsHeartbeatOk(text: string): boolean {
  return text.includes(HEARTBEAT_OK_TOKEN);
}

/**
 * Strip the HEARTBEAT_OK token from the response text.
 * Returns the cleaned text (may be empty).
 */
export function stripHeartbeatOk(text: string): string {
  return text.replace(new RegExp(HEARTBEAT_OK_TOKEN, "g"), "").trim();
}
