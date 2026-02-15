import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchDeps } from "../../pipeline/dispatch.js";
import type { MsgContext } from "../../types/messages.js";
import { dispatchWhatsAppMessage } from "./dispatch.js";

vi.mock("../../pipeline/dispatch.js", () => ({
  dispatchInboundMessage: vi.fn().mockResolvedValue({ text: "agent reply" }),
}));

function makeCtx(overrides?: Partial<MsgContext>): MsgContext {
  return {
    messageId: "msg-1",
    channel: "whatsapp",
    sessionKey: "whatsapp:dm:1234@s.whatsapp.net",
    agentId: "default",
    accountId: "1234@s.whatsapp.net",
    senderId: "1234@s.whatsapp.net",
    senderName: "Alice",
    text: "hello",
    isGroup: false,
    isCommand: false,
    timestamp: Date.now(),
    ...overrides,
  } as MsgContext;
}

function makeDeps(overrides?: {
  dmPolicy?: string;
  groupPolicy?: string;
  allowFrom?: string[];
}): DispatchDeps {
  return {
    config: {
      channels: {
        whatsapp: {
          enabled: true,
          dmPolicy: overrides?.dmPolicy ?? "open",
          groupPolicy: overrides?.groupPolicy,
          allowFrom: overrides?.allowFrom,
        },
      },
    } as DispatchDeps["config"],
    sessions: {} as DispatchDeps["sessions"],
  };
}

describe("dispatchWhatsAppMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches when DM policy is open", async () => {
    const { dispatchInboundMessage } = await import("../../pipeline/dispatch.js");
    const result = await dispatchWhatsAppMessage(makeCtx(), makeDeps());

    expect(result).toEqual({ text: "agent reply" });
    expect(dispatchInboundMessage).toHaveBeenCalled();
  });

  it("returns access denied when DM policy is disabled", async () => {
    const { dispatchInboundMessage } = await import("../../pipeline/dispatch.js");
    vi.mocked(dispatchInboundMessage).mockClear();

    const result = await dispatchWhatsAppMessage(makeCtx(), makeDeps({ dmPolicy: "disabled" }));

    expect(result).toEqual({ text: "Access denied." });
    expect(dispatchInboundMessage).not.toHaveBeenCalled();
  });

  it("allows DMs on the allowlist", async () => {
    const result = await dispatchWhatsAppMessage(
      makeCtx(),
      makeDeps({ dmPolicy: "allowlist", allowFrom: ["1234@s.whatsapp.net"] }),
    );

    expect(result).toEqual({ text: "agent reply" });
  });

  it("denies DMs not on the allowlist", async () => {
    const result = await dispatchWhatsAppMessage(
      makeCtx(),
      makeDeps({ dmPolicy: "allowlist", allowFrom: ["other@s.whatsapp.net"] }),
    );

    expect(result).toEqual({ text: "Access denied." });
  });

  it("denies groups when group policy is disabled", async () => {
    const ctx = makeCtx({
      isGroup: true,
      groupId: "group@g.us",
      sessionKey: "whatsapp:group:group@g.us",
    });

    const result = await dispatchWhatsAppMessage(ctx, makeDeps({ groupPolicy: "disabled" }));

    expect(result).toEqual({ text: "Access denied." });
  });

  it("allows groups when group policy is enabled", async () => {
    const ctx = makeCtx({
      isGroup: true,
      groupId: "group@g.us",
      sessionKey: "whatsapp:group:group@g.us",
    });

    const result = await dispatchWhatsAppMessage(ctx, makeDeps({ groupPolicy: "enabled" }));

    expect(result).toEqual({ text: "agent reply" });
  });
});
