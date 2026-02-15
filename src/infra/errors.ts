/** Format an unknown error into a readable string. */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return String(err);
}

/** Format an error with its stack trace. */
export function formatErrorWithStack(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  return formatError(err);
}

/** Wrap a promise to catch and re-throw with added context. */
export async function withContext<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new Error(`${label}: ${formatError(err)}`, { cause: err });
  }
}
