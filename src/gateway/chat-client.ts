import type { ChatEvent } from "../types/messages.js";
import type { GatewayClient } from "./client.js";

export interface ChatClient {
  send(text: string, sessionKey?: string): Promise<string>;
  onEvent(handler: (event: ChatEvent) => void): () => void;
}

let messageIdCounter = 0;

export function createChatClient(gateway: GatewayClient): ChatClient {
  const eventHandlers: Array<(event: ChatEvent) => void> = [];

  // Forward gateway messages to event handlers
  gateway.onMessage((msg) => {
    if (msg.type === "chat.delta" || msg.type === "chat.final" || msg.type === "chat.aborted") {
      const event: ChatEvent =
        msg.type === "chat.delta"
          ? { type: "delta", text: msg.text }
          : msg.type === "chat.final"
            ? { type: "final", text: msg.text, usage: msg.usage }
            : { type: "aborted", reason: msg.reason };

      for (const handler of eventHandlers) {
        handler(event);
      }
    }
  });

  return {
    async send(text, sessionKey) {
      const id = `msg-${++messageIdCounter}`;
      gateway.send({
        type: "chat.send",
        id,
        sessionKey: sessionKey ?? "terminal:dm:local",
        text,
      });
      return id;
    },

    onEvent(handler) {
      eventHandlers.push(handler);
      return () => {
        const idx = eventHandlers.indexOf(handler);
        if (idx >= 0) {
          eventHandlers.splice(idx, 1);
        }
      };
    },
  };
}
