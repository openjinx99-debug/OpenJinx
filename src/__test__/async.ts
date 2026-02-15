/**
 * Poll a condition function until it returns true or times out.
 */
export async function pollUntil(
  condition: () => boolean | Promise<boolean>,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const { intervalMs = 50, timeoutMs = 5000 } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}

/**
 * Wrap a promise with a timeout. Rejects if the promise doesn't resolve in time.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "Operation timed out",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message} (${timeoutMs}ms)`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Simple sleep helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
