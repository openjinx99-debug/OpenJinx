import type { IncomingHttpHeaders } from "node:http";
import type { ChannelId } from "./config.js";
import type { MsgContext, ReplyPayload, ChatEvent } from "./messages.js";

/** A channel plugin adapter. */
export interface ChannelPlugin {
  /** Unique channel identifier. */
  id: ChannelId;
  /** Display name. */
  name: string;
  /** Channel capabilities. */
  capabilities: ChannelCapabilities;
  /** Start the channel adapter (connect, begin polling, etc.). */
  start(): Promise<void>;
  /** Stop the channel adapter gracefully. */
  stop(): Promise<void>;
  /** Send a reply payload to a destination. */
  send(to: string, payload: ReplyPayload, ctx?: MsgContext): Promise<string | undefined>;
  /** Subscribe to streaming chat events for a session. */
  onStreamEvent?(sessionKey: string, event: ChatEvent): void;
  /** Check if the channel is ready to send messages. */
  isReady(): boolean;
  /** Handle an incoming webhook request (for channels using push mode). */
  handleWebhookRequest?(
    body: string,
    headers: IncomingHttpHeaders,
  ): Promise<{ status: number; body: string }>;
}

export interface ChannelCapabilities {
  /** Supports markdown formatting. */
  markdown: boolean;
  /** Supports inline images. */
  images: boolean;
  /** Supports audio messages. */
  audio: boolean;
  /** Supports video messages. */
  video: boolean;
  /** Supports document/file attachments. */
  documents: boolean;
  /** Supports reactions. */
  reactions: boolean;
  /** Supports message editing. */
  editing: boolean;
  /** Supports streaming (progressive message updates). */
  streaming: boolean;
  /** Max text message length. */
  maxTextLength: number;
}

/** Channel metadata for display / introspection. */
export interface ChannelMeta {
  id: ChannelId;
  name: string;
  enabled: boolean;
  ready: boolean;
  capabilities: ChannelCapabilities;
}
