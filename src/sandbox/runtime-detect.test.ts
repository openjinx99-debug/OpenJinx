import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process before importing
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// Mock os.platform
const mockPlatform = vi.fn();
vi.mock("node:os", () => ({
  default: { platform: () => mockPlatform() },
}));

const { isAppleContainerReady, describeRuntime, _resetRuntimeCache } =
  await import("./runtime-detect.js");

describe("runtime-detect", () => {
  beforeEach(() => {
    _resetRuntimeCache();
    mockExecFileSync.mockReset();
    mockPlatform.mockReset();
  });

  afterEach(() => {
    _resetRuntimeCache();
  });

  it("returns false on non-darwin platform", () => {
    mockPlatform.mockReturnValue("linux");
    expect(isAppleContainerReady()).toBe(false);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("returns true when container list succeeds (service running)", () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    expect(isAppleContainerReady()).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith("container", ["list"], {
      stdio: "pipe",
      timeout: 5000,
    });
  });

  it("returns false when container list throws (service not running)", () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFileSync.mockImplementation(() => {
      throw new Error("XPC connection error: Connection invalid");
    });
    expect(isAppleContainerReady()).toBe(false);
  });

  it("returns false when container CLI not found", () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(isAppleContainerReady()).toBe(false);
  });

  it("caches result on second call", () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFileSync.mockReturnValue(Buffer.from("ok"));

    isAppleContainerReady();
    isAppleContainerReady();

    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("_resetRuntimeCache clears cache so execFileSync is called again", () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFileSync.mockReturnValue(Buffer.from("ok"));

    isAppleContainerReady();
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);

    _resetRuntimeCache();
    isAppleContainerReady();
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });

  it("describeRuntime returns available message when true", () => {
    const msg = describeRuntime(true);
    expect(msg).toContain("Apple Container");
    expect(msg).toContain("macOS native");
  });

  it("describeRuntime returns not-ready message when false", () => {
    const msg = describeRuntime(false);
    expect(msg).toContain("not ready");
    expect(msg).toContain("container system start");
  });
});
