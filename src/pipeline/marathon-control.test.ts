import { describe, expect, it } from "vitest";
import { createTestConfig } from "../__test__/config.js";
import {
  buildControlPolicy,
  extractGroupIdFromSessionKey,
  getChannelAllowlist,
  type MarathonControlPolicyInput,
} from "./marathon-control.js";

describe("extractGroupIdFromSessionKey", () => {
  it("extracts group id from group session keys", () => {
    expect(extractGroupIdFromSessionKey("telegram:group:group-123")).toBe("group-123");
    expect(extractGroupIdFromSessionKey("whatsapp:group:abc")).toBe("abc");
  });

  it("returns undefined for non-group session keys", () => {
    expect(extractGroupIdFromSessionKey("telegram:dm:123")).toBeUndefined();
    expect(extractGroupIdFromSessionKey("terminal:local")).toBeUndefined();
  });
});

describe("getChannelAllowlist", () => {
  it("returns channel-specific allowlist", () => {
    const config = createTestConfig({
      channels: {
        terminal: { allowFrom: ["term-a"] },
        telegram: { allowFrom: ["tg-a"] },
        whatsapp: { allowFrom: ["wa-a"] },
      },
    });

    expect(getChannelAllowlist("terminal", config)).toEqual(["term-a"]);
    expect(getChannelAllowlist("telegram", config)).toEqual(["tg-a"]);
    expect(getChannelAllowlist("whatsapp", config)).toEqual(["wa-a"]);
    expect(getChannelAllowlist("unknown", config)).toEqual([]);
  });
});

describe("buildControlPolicy", () => {
  it("merges owner, marathon allowlist, and channel allowlist with de-duplication", () => {
    const config = createTestConfig({
      marathon: {
        control: {
          allowFrom: ["maintainer-1", "shared"],
          allowSameGroupMembers: true,
        },
      },
      channels: {
        telegram: {
          allowFrom: ["shared", "telegram-mod"],
        },
      },
    });
    const input: MarathonControlPolicyInput = {
      channel: "telegram",
      originSessionKey: "telegram:group:group-123",
      senderId: "owner-1",
    };

    const policy = buildControlPolicy(input, config);
    expect(policy.ownerSenderId).toBe("owner-1");
    expect(policy.originGroupId).toBe("group-123");
    expect(policy.allowSameGroupMembers).toBe(true);
    expect(new Set(policy.allowedSenderIds)).toEqual(
      new Set(["owner-1", "maintainer-1", "shared", "telegram-mod"]),
    );
  });

  it("uses explicit groupId over session-derived value and gates same-group access", () => {
    const config = createTestConfig({
      marathon: {
        control: {
          allowFrom: [],
          allowSameGroupMembers: true,
        },
      },
    });
    const withGroup: MarathonControlPolicyInput = {
      channel: "telegram",
      originSessionKey: "telegram:dm:123",
      senderId: "owner-1",
      groupId: "override-group",
    };
    const noGroup: MarathonControlPolicyInput = {
      channel: "telegram",
      originSessionKey: "telegram:dm:123",
      senderId: "owner-1",
    };

    expect(buildControlPolicy(withGroup, config).allowSameGroupMembers).toBe(true);
    expect(buildControlPolicy(noGroup, config).allowSameGroupMembers).toBe(false);
  });
});
