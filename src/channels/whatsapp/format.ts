/**
 * Convert Markdown formatting to WhatsApp-compatible formatting.
 *
 * WhatsApp uses:
 *   *bold*  _italic_  ```code```  ~strikethrough~
 *
 * Markdown uses:
 *   **bold**  *italic*  `code`  ~~strikethrough~~
 */
export function markdownToWhatsApp(md: string): string {
  let out = md;

  // Fenced code blocks: ```lang\n...\n``` → ```\n...\n```
  out = out.replace(/```(?:\w*)\n?([\s\S]*?)```/g, "```\n$1```");

  // Inline code: `...` → ```...``` (lookbehind/ahead prevents matching inside fenced blocks)
  out = out.replace(/(?<!`)`(?!`)([^`]+)(?<!`)`(?!`)/g, "```$1```");

  // Italic first: *text* → _text_ (lookahead/behind prevents matching **)
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_");

  // Bold: **text** → *text* (WhatsApp bold)
  out = out.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Strikethrough: ~~text~~ → ~text~
  out = out.replace(/~~(.+?)~~/g, "~$1~");

  // Links: [text](url) → text (url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  return out;
}
