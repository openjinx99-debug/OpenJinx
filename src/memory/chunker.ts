export interface Chunk {
  content: string;
  startLine: number;
  endLine: number;
  tokenEstimate: number;
}

const DEFAULT_CHUNK_SIZE = 400; // tokens
const DEFAULT_OVERLAP = 80; // tokens
export const CHARS_PER_TOKEN = 4; // rough estimate

/**
 * Split markdown content into overlapping chunks.
 * Tries to split on markdown boundaries (headers, blank lines).
 */
export function chunkMarkdown(
  content: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];

  const targetChars = chunkSize * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;

  let startLine = 0;
  let currentChars = 0;
  let chunkLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    chunkLines.push(lines[i]);
    currentChars += lines[i].length + 1; // +1 for newline

    const atBoundary = isMarkdownBoundary(lines[i + 1]);
    const overTarget = currentChars >= targetChars;

    if ((overTarget && atBoundary) || i === lines.length - 1) {
      const chunkContent = chunkLines.join("\n").trim();
      if (chunkContent) {
        chunks.push({
          content: chunkContent,
          startLine: startLine + 1, // 1-indexed
          endLine: i + 1,
          tokenEstimate: Math.ceil(chunkContent.length / CHARS_PER_TOKEN),
        });
      }

      // Overlap: back up by overlapChars worth of lines
      const overlapLines = computeOverlapStart(chunkLines, overlapChars);
      startLine = i + 1 - overlapLines;
      chunkLines = lines.slice(startLine, i + 1);
      currentChars = chunkLines.join("\n").length;
    }
  }

  return chunks;
}

function isMarkdownBoundary(line: string | undefined): boolean {
  if (line === undefined) {
    return true;
  }
  if (line.trim() === "") {
    return true;
  }
  if (line.startsWith("#")) {
    return true;
  }
  if (line.startsWith("---")) {
    return true;
  }
  return false;
}

function computeOverlapStart(lines: string[], overlapChars: number): number {
  let chars = 0;
  let count = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    chars += lines[i].length + 1;
    count++;
    if (chars >= overlapChars) {
      break;
    }
  }
  return count;
}
