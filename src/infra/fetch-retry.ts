import { createLogger } from "./logger.js";

const logger = createLogger("fetch-retry");

const RETRY_BASE_MS = 500;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Fetch with automatic retry for 5xx and 429 responses.
 * Retries with exponential backoff (500ms base). No retry on 4xx (except 429).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = DEFAULT_MAX_RETRIES,
): Promise<Response> {
  let lastResp: Response | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, init);
    if (resp.ok) {
      return resp;
    }
    // Only retry on 5xx or 429 (rate limit)
    if (resp.status !== 429 && resp.status < 500) {
      return resp;
    }
    lastResp = resp;
    if (attempt < maxRetries) {
      const delay = RETRY_BASE_MS * 2 ** attempt;
      logger.debug(`Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return lastResp!;
}
