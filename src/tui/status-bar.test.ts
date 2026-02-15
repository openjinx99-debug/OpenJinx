import { describe, expect, it } from "vitest";
import { renderStatusBar, type StatusBarState } from "./status-bar.js";

describe("renderStatusBar", () => {
  it("shows connected state", () => {
    const state: StatusBarState = {
      connected: true,
      model: "claude-sonnet",
      sessionKey: "tui:dm:1",
      streaming: false,
    };
    const bar = renderStatusBar(state);
    expect(bar).toContain("connected");
    expect(bar).toContain("claude-sonnet");
    expect(bar).toContain("tui:dm:1");
  });

  it("shows disconnected state", () => {
    const state: StatusBarState = {
      connected: false,
      model: "claude",
      sessionKey: "",
      streaming: false,
    };
    const bar = renderStatusBar(state);
    expect(bar).toContain("disconnected");
  });

  it("shows token counts when provided", () => {
    const state: StatusBarState = {
      connected: true,
      model: "claude",
      sessionKey: "tui:dm:1",
      tokenCount: { input: 100, output: 50 },
      streaming: false,
    };
    const bar = renderStatusBar(state);
    expect(bar).toContain("100/50 tokens");
  });

  it("shows streaming indicator", () => {
    const state: StatusBarState = {
      connected: true,
      model: "claude",
      sessionKey: "tui:dm:1",
      streaming: true,
    };
    const bar = renderStatusBar(state);
    expect(bar).toContain("streaming");
  });

  it("omits token counts when not provided", () => {
    const state: StatusBarState = {
      connected: true,
      model: "claude",
      sessionKey: "",
      streaming: false,
    };
    const bar = renderStatusBar(state);
    expect(bar).not.toContain("tokens");
  });
});
