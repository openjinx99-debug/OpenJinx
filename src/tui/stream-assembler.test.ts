import { describe, expect, it } from "vitest";
import { StreamAssembler } from "./stream-assembler.js";

describe("StreamAssembler", () => {
  it("assembles delta events into text", () => {
    const asm = new StreamAssembler();
    asm.process({ type: "delta", text: "Hello " });
    asm.process({ type: "delta", text: "world" });
    expect(asm.text).toBe("Hello world");
  });

  it("returns final text on final event", () => {
    const asm = new StreamAssembler();
    asm.process({ type: "delta", text: "partial" });
    asm.process({ type: "final", text: "complete text" });
    expect(asm.text).toBe("complete text");
    expect(asm.isComplete).toBe(true);
  });

  it("tracks thinking text separately from content", () => {
    const asm = new StreamAssembler();
    asm.process({ type: "thinking", text: "Let me think..." });
    asm.process({ type: "delta", text: "Answer" });
    expect(asm.text).toBe("Answer");
    expect(asm.thinking).toBe("Let me think...");
    expect(asm.hasThinking).toBe(true);
  });

  it("accumulates multiple thinking events", () => {
    const asm = new StreamAssembler();
    asm.process({ type: "thinking", text: "Part 1" });
    asm.process({ type: "thinking", text: " Part 2" });
    expect(asm.thinking).toBe("Part 1 Part 2");
  });

  it("handles interleaved thinking and delta events", () => {
    const asm = new StreamAssembler();
    asm.process({ type: "thinking", text: "thinking..." });
    asm.process({ type: "delta", text: "Hello" });
    asm.process({ type: "thinking", text: "more thinking" });
    asm.process({ type: "delta", text: " World" });
    expect(asm.text).toBe("Hello World");
    expect(asm.thinking).toBe("thinking...more thinking");
  });

  it("reset clears thinking state", () => {
    const asm = new StreamAssembler();
    asm.process({ type: "thinking", text: "thought" });
    asm.process({ type: "delta", text: "text" });
    asm.reset();
    expect(asm.text).toBe("");
    expect(asm.thinking).toBe("");
    expect(asm.hasThinking).toBe(false);
    expect(asm.isComplete).toBe(false);
  });

  it("handles aborted event", () => {
    const asm = new StreamAssembler();
    asm.process({ type: "delta", text: "partial" });
    const result = asm.process({ type: "aborted", reason: "timeout" });
    expect(result).toContain("aborted: timeout");
    expect(asm.isComplete).toBe(true);
  });

  it("hasThinking is false when no thinking events", () => {
    const asm = new StreamAssembler();
    asm.process({ type: "delta", text: "text" });
    expect(asm.hasThinking).toBe(false);
    expect(asm.thinking).toBe("");
  });
});
