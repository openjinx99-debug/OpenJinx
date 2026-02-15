import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock loadSkillEntries
const mockLoadSkillEntries = vi.fn();
vi.mock("./loader.js", () => ({
  loadSkillEntries: (...args: unknown[]) => mockLoadSkillEntries(...args),
}));

// Mock fs.watch
const mockWatchClose = vi.fn();
const mockWatch = vi.fn();
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      watch: (...args: unknown[]) => mockWatch(...args),
    },
  };
});

const { startSkillRefresh, startSkillWatcher } = await import("./refresh.js");

describe("startSkillRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockLoadSkillEntries.mockResolvedValue([
      { name: "test-skill", displayName: "Test", description: "A test skill" },
    ]);
    mockWatch.mockReturnValue({
      on: vi.fn().mockReturnThis(),
      close: mockWatchClose,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls callback on interval with loaded skills", async () => {
    const callback = vi.fn();
    const stop = startSkillRefresh(["/skills"], callback, 1000);

    // Advance past one interval
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockLoadSkillEntries).toHaveBeenCalledWith(["/skills"]);
    expect(callback).toHaveBeenCalledWith([
      { name: "test-skill", displayName: "Test", description: "A test skill" },
    ]);

    stop();
  });

  it("stop function clears interval and closes watchers", () => {
    const callback = vi.fn();
    const stop = startSkillRefresh(["/skills"], callback, 1000);

    stop();

    expect(mockWatchClose).toHaveBeenCalled();
  });

  it("handles loadSkillEntries errors gracefully", async () => {
    mockLoadSkillEntries.mockRejectedValueOnce(new Error("disk error"));

    const callback = vi.fn();
    const stop = startSkillRefresh(["/skills"], callback, 1000);

    await vi.advanceTimersByTimeAsync(1000);

    // Callback should not be called when load fails
    expect(callback).not.toHaveBeenCalled();

    stop();
  });
});

describe("startSkillWatcher", () => {
  beforeEach(() => {
    mockWatch.mockReset();
    mockWatchClose.mockReset();
    mockWatch.mockReturnValue({
      on: vi.fn().mockReturnThis(),
      close: mockWatchClose,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a watcher for each directory", () => {
    const watchers = startSkillWatcher(["/skills/a", "/skills/b"], vi.fn());

    expect(mockWatch).toHaveBeenCalledTimes(2);
    expect(watchers).toHaveLength(2);

    for (const w of watchers) {
      w.close();
    }
  });

  it("falls back gracefully when fs.watch throws", () => {
    mockWatch.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    mockWatch.mockReturnValueOnce({
      on: vi.fn().mockReturnThis(),
      close: mockWatchClose,
    });

    const watchers = startSkillWatcher(["/bad/dir", "/good/dir"], vi.fn());

    // Only the second directory should have a watcher
    expect(watchers).toHaveLength(1);

    for (const w of watchers) {
      w.close();
    }
  });
});
