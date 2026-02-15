import { describe, expect, it } from "vitest";
import { createEventQueue } from "./queue.js";

describe("EventQueue", () => {
  it("enqueues and drains events", () => {
    const queue = createEventQueue();
    queue.enqueue("event 1", "session-1", "system");
    queue.enqueue("event 2", "session-1", "heartbeat");

    expect(queue.count("session-1")).toBe(2);

    const events = queue.drain("session-1");
    expect(events).toHaveLength(2);
    expect(events[0].text).toBe("event 1");
    expect(events[1].text).toBe("event 2");

    // Drain clears the queue
    expect(queue.count("session-1")).toBe(0);
  });

  it("suppresses consecutive duplicates", () => {
    const queue = createEventQueue();
    queue.enqueue("same text", "session-1", "system");
    queue.enqueue("same text", "session-1", "system");
    queue.enqueue("different", "session-1", "system");
    queue.enqueue("same text", "session-1", "system"); // not consecutive to prev "same text"

    expect(queue.count("session-1")).toBe(3);
  });

  it("enforces max queue size", () => {
    const queue = createEventQueue();
    for (let i = 0; i < 25; i++) {
      queue.enqueue(`event-${i}`, "session-1", "system");
    }

    expect(queue.count("session-1")).toBe(20);

    const events = queue.drain("session-1");
    // Oldest events should have been dropped
    expect(events[0].text).toBe("event-5");
  });

  it("separates events by session key", () => {
    const queue = createEventQueue();
    queue.enqueue("a", "session-1", "system");
    queue.enqueue("b", "session-2", "system");

    expect(queue.count("session-1")).toBe(1);
    expect(queue.count("session-2")).toBe(1);
  });

  it("peek returns events without consuming", () => {
    const queue = createEventQueue();
    queue.enqueue("event", "session-1", "system");

    const peeked = queue.peek("session-1");
    expect(peeked).toHaveLength(1);
    expect(queue.count("session-1")).toBe(1); // Still there
  });
});
