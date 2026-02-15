/**
 * Run a promise with a timeout. Rejects with the given message if the timeout fires.
 * Cleans up the timer on completion to avoid leaks.
 * If ms <= 0, returns the promise as-is (no timeout).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (ms <= 0) {
    return promise;
  }
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
