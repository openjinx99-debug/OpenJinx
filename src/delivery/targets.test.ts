import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../types/sessions.js";
import { resolveDeliveryTarget } from "./targets.js";

function makeSession(overrides?: Partial<SessionEntry>): SessionEntry {
  return {
    sessionId: "sess-1",
    sessionKey: "telegram:dm:user1",
    agentId: "default",
    channel: "telegram",
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    turnCount: 5,
    transcriptPath: "/tmp/transcript.jsonl",
    totalInputTokens: 500,
    totalOutputTokens: 500,
    contextTokens: 1000,
    locked: false,
    peerId: "user1",
    ...overrides,
  };
}

describe("resolveDeliveryTarget", () => {
  it("returns undefined for 'none'", () => {
    expect(resolveDeliveryTarget("none")).toBeUndefined();
  });

  it("resolves 'last' from session", () => {
    const session = makeSession();
    const target = resolveDeliveryTarget("last", session);
    expect(target).toEqual({
      channel: "telegram",
      to: "user1",
    });
  });

  it("prefers groupId for 'last' resolution", () => {
    const session = makeSession({ groupId: "group123", peerId: "user1" });
    const target = resolveDeliveryTarget("last", session);
    expect(target?.to).toBe("group123");
  });

  it("returns undefined for 'last' without session", () => {
    expect(resolveDeliveryTarget("last")).toBeUndefined();
  });

  it("passes through explicit target", () => {
    const explicit = { channel: "whatsapp" as const, to: "+1234567890" };
    expect(resolveDeliveryTarget(explicit)).toEqual(explicit);
  });
});
