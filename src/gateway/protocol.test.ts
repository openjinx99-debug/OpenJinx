import { describe, expect, it } from "vitest";
import { LIMITS } from "../infra/security.js";
import { parseInboundMessage } from "./protocol.js";

describe("parseInboundMessage", () => {
  it("parses a valid chat.send message", () => {
    const raw = JSON.stringify({
      type: "chat.send",
      id: "msg-1",
      sessionKey: "session-abc",
      text: "Hello world",
    });
    const result = parseInboundMessage(raw);
    expect(result).toEqual({
      type: "chat.send",
      id: "msg-1",
      sessionKey: "session-abc",
      text: "Hello world",
    });
  });

  it("parses a valid health.check message", () => {
    const raw = JSON.stringify({ type: "health.check" });
    const result = parseInboundMessage(raw);
    expect(result).toEqual({ type: "health.check" });
  });

  it("parses a valid config.reload message", () => {
    const raw = JSON.stringify({ type: "config.reload" });
    const result = parseInboundMessage(raw);
    expect(result).toEqual({ type: "config.reload" });
  });

  it("returns null for invalid JSON", () => {
    expect(parseInboundMessage("{not json")).toBeNull();
    expect(parseInboundMessage("")).toBeNull();
    expect(parseInboundMessage("undefined")).toBeNull();
  });

  it("returns null for missing required fields", () => {
    // chat.send missing text
    expect(
      parseInboundMessage(JSON.stringify({ type: "chat.send", id: "1", sessionKey: "s" })),
    ).toBeNull();

    // chat.send missing id
    expect(
      parseInboundMessage(JSON.stringify({ type: "chat.send", sessionKey: "s", text: "hi" })),
    ).toBeNull();

    // chat.send missing sessionKey
    expect(
      parseInboundMessage(JSON.stringify({ type: "chat.send", id: "1", text: "hi" })),
    ).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(
      parseInboundMessage(
        JSON.stringify({ type: "chat.send", id: "1", sessionKey: "s", text: "" }),
      ),
    ).toBeNull();
  });

  it("returns null for oversized text", () => {
    const oversized = "x".repeat(LIMITS.MAX_MESSAGE_TEXT_BYTES + 1);
    expect(
      parseInboundMessage(
        JSON.stringify({ type: "chat.send", id: "1", sessionKey: "s", text: oversized }),
      ),
    ).toBeNull();
  });

  it("returns null for unknown message type", () => {
    expect(parseInboundMessage(JSON.stringify({ type: "unknown.type" }))).toBeNull();
  });

  it("parses a valid heartbeat.wake message", () => {
    const raw = JSON.stringify({ type: "heartbeat.wake", agentId: "default" });
    const result = parseInboundMessage(raw);
    expect(result).toEqual({ type: "heartbeat.wake", agentId: "default" });
  });

  it("rejects heartbeat.wake with empty agentId", () => {
    const raw = JSON.stringify({ type: "heartbeat.wake", agentId: "" });
    expect(parseInboundMessage(raw)).toBeNull();
  });

  it("rejects heartbeat.wake without agentId", () => {
    const raw = JSON.stringify({ type: "heartbeat.wake" });
    expect(parseInboundMessage(raw)).toBeNull();
  });
});
