import type { ChatEvent } from "../types/messages.js";

/**
 * Assembles streaming deltas into complete display text.
 * Also tracks thinking blocks separately from content.
 */
export class StreamAssembler {
  private chunks: string[] = [];
  private finalText = "";
  private completed = false;
  private thinkingChunks: string[] = [];

  /** Process a stream event, returns the current assembled text. */
  process(event: ChatEvent): string {
    switch (event.type) {
      case "delta":
        this.chunks.push(event.text);
        return this.chunks.join("");
      case "thinking":
        this.thinkingChunks.push(event.text);
        return this.chunks.join("");
      case "final":
        this.finalText = event.text;
        this.completed = true;
        return this.finalText;
      case "aborted":
        this.completed = true;
        return this.chunks.join("") + "\n[aborted: " + event.reason + "]";
      default:
        return this.chunks.join("");
    }
  }

  get text(): string {
    return this.completed ? this.finalText : this.chunks.join("");
  }

  get thinking(): string {
    return this.thinkingChunks.join("");
  }

  get hasThinking(): boolean {
    return this.thinkingChunks.length > 0;
  }

  get isComplete(): boolean {
    return this.completed;
  }

  reset(): void {
    this.chunks = [];
    this.finalText = "";
    this.completed = false;
    this.thinkingChunks = [];
  }
}
