import { afterEach, describe, expect, it } from "vitest";
import {
  clearSubagentRegistry,
  completeSubagent,
  getSubagent,
  listSubagentsForParent,
  registerSubagent,
  removeSubagent,
} from "./subagent-registry.js";

describe("subagent-registry", () => {
  afterEach(() => {
    clearSubagentRegistry();
  });

  it("registers and retrieves a subagent", () => {
    registerSubagent({
      subagentSessionKey: "subagent:abc",
      parentSessionKey: "parent:1",
      task: "Do something",
      status: "running",
      createdAt: Date.now(),
    });

    const entry = getSubagent("subagent:abc");
    expect(entry).toBeDefined();
    expect(entry!.task).toBe("Do something");
    expect(entry!.status).toBe("running");
  });

  it("completes a subagent", () => {
    registerSubagent({
      subagentSessionKey: "subagent:abc",
      parentSessionKey: "parent:1",
      task: "Do something",
      status: "running",
      createdAt: Date.now(),
    });

    completeSubagent("subagent:abc", "Done!", "completed");

    const entry = getSubagent("subagent:abc");
    expect(entry!.status).toBe("completed");
    expect(entry!.resultText).toBe("Done!");
    expect(entry!.completedAt).toBeDefined();
  });

  it("removes a subagent", () => {
    registerSubagent({
      subagentSessionKey: "subagent:abc",
      parentSessionKey: "parent:1",
      task: "Do something",
      status: "running",
      createdAt: Date.now(),
    });

    const removed = removeSubagent("subagent:abc");
    expect(removed).toBe(true);
    expect(getSubagent("subagent:abc")).toBeUndefined();
  });

  it("lists subagents for a parent", () => {
    registerSubagent({
      subagentSessionKey: "subagent:1",
      parentSessionKey: "parent:A",
      task: "Task 1",
      status: "running",
      createdAt: Date.now(),
    });
    registerSubagent({
      subagentSessionKey: "subagent:2",
      parentSessionKey: "parent:A",
      task: "Task 2",
      status: "completed",
      createdAt: Date.now(),
    });
    registerSubagent({
      subagentSessionKey: "subagent:3",
      parentSessionKey: "parent:B",
      task: "Task 3",
      status: "running",
      createdAt: Date.now(),
    });

    const parentA = listSubagentsForParent("parent:A");
    expect(parentA).toHaveLength(2);

    const parentB = listSubagentsForParent("parent:B");
    expect(parentB).toHaveLength(1);
  });

  it("returns undefined for unknown subagent", () => {
    expect(getSubagent("nonexistent")).toBeUndefined();
  });

  it("returns false when removing nonexistent subagent", () => {
    expect(removeSubagent("nonexistent")).toBe(false);
  });
});
