import { describe, expect, it } from "vitest";
import { buildMsgContext } from "./context.js";

describe("buildMsgContext", () => {
  it("builds context for a DM", () => {
    const ctx = buildMsgContext({
      messageId: "msg-1",
      channel: "telegram",
      text: "Hello there",
      senderId: "user-123",
      senderName: "Alice",
      accountId: "bot-456",
      isGroup: false,
    });

    expect(ctx.channel).toBe("telegram");
    expect(ctx.text).toBe("Hello there");
    expect(ctx.sessionKey).toBe("telegram:dm:user-123");
    expect(ctx.isCommand).toBe(false);
    expect(ctx.isGroup).toBe(false);
  });

  it("builds context for a group message", () => {
    const ctx = buildMsgContext({
      messageId: "msg-2",
      channel: "whatsapp",
      text: "Hey everyone",
      senderId: "user-123",
      senderName: "Bob",
      accountId: "bot-456",
      isGroup: true,
      groupId: "group-789",
      groupName: "Test Group",
    });

    expect(ctx.sessionKey).toBe("whatsapp:group:group-789");
    expect(ctx.isGroup).toBe(true);
    expect(ctx.groupId).toBe("group-789");
  });

  it("parses slash commands", () => {
    const ctx = buildMsgContext({
      messageId: "msg-3",
      channel: "terminal",
      text: "/search how to cook pasta",
      senderId: "user-1",
      senderName: "User",
      accountId: "local",
      isGroup: false,
    });

    expect(ctx.isCommand).toBe(true);
    expect(ctx.commandName).toBe("search");
    expect(ctx.commandArgs).toBe("how to cook pasta");
  });

  it("handles commands without arguments", () => {
    const ctx = buildMsgContext({
      messageId: "msg-4",
      channel: "terminal",
      text: "/status",
      senderId: "user-1",
      senderName: "User",
      accountId: "local",
      isGroup: false,
    });

    expect(ctx.isCommand).toBe(true);
    expect(ctx.commandName).toBe("status");
    expect(ctx.commandArgs).toBe("");
  });

  it("generates terminal DM session key", () => {
    const ctx = buildMsgContext({
      messageId: "msg-5",
      channel: "terminal",
      text: "hello",
      senderId: "local-user",
      senderName: "User",
      accountId: "local",
      isGroup: false,
    });
    expect(ctx.sessionKey).toBe("terminal:dm:local-user");
  });

  it("generates whatsapp group session key", () => {
    const ctx = buildMsgContext({
      messageId: "msg-6",
      channel: "whatsapp",
      text: "hey",
      senderId: "user-1",
      senderName: "User",
      accountId: "bot-1",
      isGroup: true,
      groupId: "group-abc",
    });
    expect(ctx.sessionKey).toBe("whatsapp:group:group-abc");
  });

  it("trims whitespace from text", () => {
    const ctx = buildMsgContext({
      messageId: "msg-7",
      channel: "telegram",
      text: "  hello  ",
      senderId: "user-1",
      senderName: "User",
      accountId: "bot-1",
      isGroup: false,
    });
    expect(ctx.text).toBe("hello");
  });

  it("assigns default agentId", () => {
    const ctx = buildMsgContext({
      messageId: "msg-8",
      channel: "telegram",
      text: "test",
      senderId: "user-1",
      senderName: "User",
      accountId: "bot-1",
      isGroup: false,
    });
    expect(ctx.agentId).toBe("default");
  });

  it("records a timestamp", () => {
    const before = Date.now();
    const ctx = buildMsgContext({
      messageId: "msg-9",
      channel: "telegram",
      text: "test",
      senderId: "user-1",
      senderName: "User",
      accountId: "bot-1",
      isGroup: false,
    });
    const after = Date.now();
    expect(ctx.timestamp).toBeGreaterThanOrEqual(before);
    expect(ctx.timestamp).toBeLessThanOrEqual(after);
  });
});
