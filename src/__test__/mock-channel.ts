import type { ChannelPlugin, ChannelCapabilities } from "../types/channels.js";
import type { ChannelId } from "../types/config.js";
import type { MsgContext, ReplyPayload, ChatEvent } from "../types/messages.js";

export interface CapturedDelivery {
  to: string;
  payload: ReplyPayload;
  ctx?: MsgContext;
  timestamp: number;
}

export interface CapturedStreamEvent {
  sessionKey: string;
  event: ChatEvent;
  timestamp: number;
}

/**
 * Mock channel adapter implementing the ChannelPlugin interface.
 * Records all deliveries and stream events for test assertions.
 */
export function createMockChannel(
  channelId: ChannelId = "telegram",
  overrides?: Partial<ChannelCapabilities>,
): ChannelPlugin & {
  deliveries: CapturedDelivery[];
  streamEvents: CapturedStreamEvent[];
  waitForDelivery: (timeoutMs?: number) => Promise<CapturedDelivery>;
  getDeliveriesTo: (recipient: string) => CapturedDelivery[];
  reset: () => void;
} {
  const deliveries: CapturedDelivery[] = [];
  const streamEvents: CapturedStreamEvent[] = [];
  let deliveryResolvers: Array<(d: CapturedDelivery) => void> = [];

  const capabilities: ChannelCapabilities = {
    markdown: true,
    images: false,
    audio: false,
    video: false,
    documents: false,
    reactions: false,
    editing: false,
    streaming: true,
    maxTextLength: 4096,
    ...overrides,
  };

  return {
    id: channelId,
    name: `Mock ${channelId}`,
    capabilities,
    deliveries,
    streamEvents,

    async start() {},
    async stop() {},

    async send(to: string, payload: ReplyPayload, ctx?: MsgContext): Promise<string | undefined> {
      const delivery: CapturedDelivery = {
        to,
        payload,
        ctx,
        timestamp: Date.now(),
      };
      deliveries.push(delivery);

      // Resolve any pending waitForDelivery promises
      for (const resolver of deliveryResolvers) {
        resolver(delivery);
      }
      deliveryResolvers = [];

      return `msg-${Date.now()}`;
    },

    onStreamEvent(sessionKey: string, event: ChatEvent) {
      streamEvents.push({ sessionKey, event, timestamp: Date.now() });
    },

    isReady() {
      return true;
    },

    waitForDelivery(timeoutMs = 5000): Promise<CapturedDelivery> {
      if (deliveries.length > 0) {
        return Promise.resolve(deliveries[deliveries.length - 1]);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`waitForDelivery timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        deliveryResolvers.push((d) => {
          clearTimeout(timer);
          resolve(d);
        });
      });
    },

    getDeliveriesTo(recipient: string): CapturedDelivery[] {
      return deliveries.filter((d) => d.to === recipient);
    },

    reset() {
      deliveries.length = 0;
      streamEvents.length = 0;
      deliveryResolvers = [];
    },
  };
}

export type MockChannel = ReturnType<typeof createMockChannel>;
