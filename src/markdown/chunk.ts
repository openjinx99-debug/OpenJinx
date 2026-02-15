/**
 * Split text into chunks that fit within a character limit,
 * preferring breaks at newlines and whitespace boundaries.
 *
 * Ported from OpenClaw's auto-reply/chunk.ts.
 */
export function chunkText(text: string, limit: number): string[] {
  if (!text) {
    return [];
  }
  if (limit <= 0) {
    return [text];
  }
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);

    // 1) Prefer a newline break inside the window (outside parentheses).
    const { lastNewline, lastWhitespace } = scanParenAwareBreakpoints(window);

    // 2) Otherwise prefer the last whitespace (word boundary) inside the window.
    let breakIdx = lastNewline > 0 ? lastNewline : lastWhitespace;

    // 3) Fallback: hard break exactly at the limit.
    if (breakIdx <= 0) {
      breakIdx = limit;
    }

    const rawChunk = remaining.slice(0, breakIdx);
    const chunk = rawChunk.trimEnd();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // If we broke on whitespace/newline, skip that separator; for hard breaks keep it.
    const brokeOnSeparator = breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
    const nextStart = Math.min(remaining.length, breakIdx + (brokeOnSeparator ? 1 : 0));
    remaining = remaining.slice(nextStart).trimStart();
  }

  if (remaining.length) {
    chunks.push(remaining);
  }

  return chunks;
}

export function scanParenAwareBreakpoints(
  window: string,
  isAllowed: (index: number) => boolean = () => true,
): { lastNewline: number; lastWhitespace: number } {
  let lastNewline = -1;
  let lastWhitespace = -1;
  let depth = 0;

  for (let i = 0; i < window.length; i++) {
    if (!isAllowed(i)) {
      continue;
    }
    const char = window[i];
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth !== 0) {
      continue;
    }
    if (char === "\n") {
      lastNewline = i;
    } else if (/\s/.test(char)) {
      lastWhitespace = i;
    }
  }

  return { lastNewline, lastWhitespace };
}
