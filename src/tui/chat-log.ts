export interface ChatMessage {
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: number;
}

/**
 * Chat log display buffer.
 */
export class ChatLog {
  private messages: ChatMessage[] = [];

  add(message: ChatMessage): void {
    this.messages.push(message);
  }

  getAll(): ChatMessage[] {
    return [...this.messages];
  }

  getRecent(count: number): ChatMessage[] {
    return this.messages.slice(-count);
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }

  /** Format messages for terminal display. */
  format(): string {
    return this.messages
      .map((m) => {
        const prefix = m.role === "user" ? "You" : m.role === "assistant" ? "Jinx" : "System";
        return `[${prefix}] ${m.text}`;
      })
      .join("\n\n");
  }
}
