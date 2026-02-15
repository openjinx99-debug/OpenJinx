const MAX_FILE_CHARS = 20_000;
const HEAD_RATIO = 0.7;
const TAIL_RATIO = 0.2;

/**
 * Trim a workspace file to fit within the character cap.
 * Uses a 70% head / 20% tail strategy with a truncation notice in between.
 */
export function trimFileContent(content: string, maxChars = MAX_FILE_CHARS): string {
  if (content.length <= maxChars) {
    return content;
  }

  const headChars = Math.floor(maxChars * HEAD_RATIO);
  const tailChars = Math.floor(maxChars * TAIL_RATIO);
  const notice = `\n\n... [truncated ${content.length - headChars - tailChars} characters] ...\n\n`;
  const availableForContent = maxChars - notice.length;
  const adjustedHead = Math.floor(availableForContent * (HEAD_RATIO / (HEAD_RATIO + TAIL_RATIO)));
  const adjustedTail = availableForContent - adjustedHead;

  const head = content.slice(0, adjustedHead);
  const tail = content.slice(-adjustedTail);

  return head + notice + tail;
}

/**
 * Trim all workspace file contents in place, returning new array.
 */
export function trimWorkspaceFiles<T extends { content: string }>(
  files: T[],
  maxChars = MAX_FILE_CHARS,
): T[] {
  return files.map((f) => ({ ...f, content: trimFileContent(f.content, maxChars) }));
}
