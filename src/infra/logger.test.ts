import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("suppressSensitiveLogs", () => {
  let origInfo: typeof console.info;
  let origWarn: typeof console.warn;

  beforeEach(() => {
    origInfo = console.info;
    origWarn = console.warn;
  });

  afterEach(() => {
    console.info = origInfo;
    console.warn = origWarn;
    vi.resetModules();
  });

  it("suppresses libsignal session key messages from console.info", async () => {
    const { suppressSensitiveLogs } = await import("./logger.js");
    const spy = vi.fn();
    console.info = spy;

    suppressSensitiveLogs();

    console.info("Closing session:", { privateKey: "LEAKED" });
    console.info("Opening session:", { rootKey: "LEAKED" });
    console.info("Removing old closed session:", { key: "LEAKED" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("suppresses libsignal session key messages from console.warn", async () => {
    const { suppressSensitiveLogs } = await import("./logger.js");
    const spy = vi.fn();
    console.warn = spy;

    suppressSensitiveLogs();

    console.warn("Session already closed", { key: "LEAKED" });
    console.warn("Session already open", { key: "LEAKED" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("passes through normal messages", async () => {
    const { suppressSensitiveLogs } = await import("./logger.js");
    const infoSpy = vi.fn();
    const warnSpy = vi.fn();
    console.info = infoSpy;
    console.warn = warnSpy;

    suppressSensitiveLogs();

    console.info("WhatsApp connected");
    console.warn("Something else");

    expect(infoSpy).toHaveBeenCalledWith("WhatsApp connected");
    expect(warnSpy).toHaveBeenCalledWith("Something else");
  });
});

describe("log level filtering", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("suppresses debug messages at default info level", async () => {
    const { log, setLogLevel } = await import("./logger.js");
    setLogLevel("info");

    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    log.debug("should not appear");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("shows debug messages at debug level", async () => {
    const { log, setLogLevel } = await import("./logger.js");
    setLogLevel("debug");

    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    log.debug("should appear");

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("suppresses all messages at silent level", async () => {
    const { log, setLogLevel } = await import("./logger.js");
    setLogLevel("silent");

    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    log.debug("nope");
    log.info("nope");
    log.warn("nope");
    log.error("nope");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("shows error messages at warn level", async () => {
    const { log, setLogLevel } = await import("./logger.js");
    setLogLevel("warn");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    log.error("error visible");
    log.info("info hidden");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });
});

describe("createLogger", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("prefixes messages with the logger name", async () => {
    const { createLogger, setLogLevel } = await import("./logger.js");
    setLogLevel("debug");

    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger("dispatch");
    logger.info("test message");

    expect(spy).toHaveBeenCalledTimes(1);
    const msg = spy.mock.calls[0][0] as string;
    expect(msg).toContain("[dispatch]");
    expect(msg).toContain("test message");

    spy.mockRestore();
  });
});
