const DEFAULT_MAX_LENGTH = 4000;

/**
 * Split text into chunks that respect Telegram's message size limit.
 * Splits on paragraph boundaries and avoids breaking code blocks.
 */
export function chunkTelegramText(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = findSplitPoint(remaining, maxLength);
    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks.filter((c) => c.length > 0);
}

function findSplitPoint(text: string, maxLength: number): number {
  const slice = text.slice(0, maxLength);

  // Don't split inside a fenced code block
  const codeBlockCount = (slice.match(/```/g) ?? []).length;
  if (codeBlockCount % 2 !== 0) {
    // Odd number — we're inside a code block. Find the start of it and split before.
    const lastFenceStart = slice.lastIndexOf("```");
    if (lastFenceStart > 0) {
      const beforeFence = slice.lastIndexOf("\n\n", lastFenceStart);
      if (beforeFence > 0) {
        return beforeFence;
      }
      return lastFenceStart;
    }
  }

  // Prefer double-newline (paragraph boundary)
  const paraBreak = slice.lastIndexOf("\n\n");
  if (paraBreak > maxLength * 0.3) {
    return paraBreak;
  }

  // Fall back to single newline
  const lineBreak = slice.lastIndexOf("\n");
  if (lineBreak > maxLength * 0.3) {
    return lineBreak;
  }

  // Last resort: hard split at max length
  return maxLength;
}
