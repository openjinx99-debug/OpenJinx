import { describe, expect, it } from "vitest";
import { containsHeartbeatOk, stripHeartbeatOk } from "./heartbeat-ok.js";

describe("containsHeartbeatOk", () => {
  it("detects HEARTBEAT_OK", () => {
    expect(containsHeartbeatOk("All clear. HEARTBEAT_OK")).toBe(true);
  });

  it("returns false when absent", () => {
    expect(containsHeartbeatOk("There is something to report")).toBe(false);
  });
});

describe("stripHeartbeatOk", () => {
  it("strips the token", () => {
    expect(stripHeartbeatOk("HEARTBEAT_OK")).toBe("");
  });

  it("strips token and preserves other text", () => {
    expect(stripHeartbeatOk("All clear. HEARTBEAT_OK")).toBe("All clear.");
  });

  it("strips token surrounded by markdown bold", () => {
    expect(stripHeartbeatOk("**HEARTBEAT_OK**")).toBe("****");
  });

  it("strips token when embedded in HTML", () => {
    const input = "<p>HEARTBEAT_OK</p>";
    expect(stripHeartbeatOk(input)).toBe("<p></p>");
  });

  it("detects token in multiline text", () => {
    const multiline = "Line 1\nLine 2\nHEARTBEAT_OK\nLine 4";
    expect(containsHeartbeatOk(multiline)).toBe(true);
    const stripped = stripHeartbeatOk(multiline);
    expect(stripped).not.toContain("HEARTBEAT_OK");
    expect(stripped).toContain("Line 1");
  });

  it("strips multiple occurrences of the token", () => {
    expect(stripHeartbeatOk("HEARTBEAT_OK and HEARTBEAT_OK")).toBe("and");
  });
});
