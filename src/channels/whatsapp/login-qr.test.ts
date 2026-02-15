import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (...args: unknown[]) => void;
const eventHandlers = new Map<string, EventHandler[]>();

const mockSaveCreds = vi.fn();
const mockEnd = vi.fn();

// Mock QR renderer
const mockRenderQr = vi.fn().mockReturnValue("MOCK_QR_OUTPUT");

vi.mock("./render-qr.js", () => ({
  renderQrToTerminal: mockRenderQr,
}));

vi.mock("baileys", () => ({
  DisconnectReason: { loggedOut: 401, restartRequired: 515 },
  useMultiFileAuthState: vi.fn().mockResolvedValue({
    state: { creds: {}, keys: {} },
    saveCreds: mockSaveCreds,
  }),
  makeWASocket: vi.fn(() => ({
    ev: {
      on(event: string, handler: EventHandler) {
        const handlers = eventHandlers.get(event) ?? [];
        handlers.push(handler);
        eventHandlers.set(event, handlers);
      },
    },
    end: mockEnd,
  })),
}));

describe("startQrLogin", () => {
  let startQrLogin: typeof import("./login-qr.js").startQrLogin;

  beforeEach(async () => {
    eventHandlers.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    const mod = await import("./login-qr.js");
    startQrLogin = mod.startQrLogin;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function fireConnectionUpdate(update: Record<string, unknown>) {
    const handlers = eventHandlers.get("connection.update") ?? [];
    for (const h of handlers) {
      h(update);
    }
  }

  it("resolves true on successful connection", async () => {
    const promise = startQrLogin({ authDir: "/tmp/wa-auth", timeout: 5000 });

    // Allow microtask for async setup
    await vi.advanceTimersByTimeAsync(0);

    fireConnectionUpdate({ connection: "open" });

    const result = await promise;
    expect(result).toBe(true);
  });

  it("resolves false on connection close", async () => {
    const promise = startQrLogin({ authDir: "/tmp/wa-auth", timeout: 5000 });

    await vi.advanceTimersByTimeAsync(0);

    fireConnectionUpdate({
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });

    const result = await promise;
    expect(result).toBe(false);
  });

  it("resolves false on timeout", async () => {
    const promise = startQrLogin({ authDir: "/tmp/wa-auth", timeout: 1000 });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result).toBe(false);
    expect(mockEnd).toHaveBeenCalled();
  });

  it("forwards QR string to onQr callback", async () => {
    const onQr = vi.fn();
    const promise = startQrLogin({ authDir: "/tmp/wa-auth", timeout: 5000, onQr });

    await vi.advanceTimersByTimeAsync(0);

    fireConnectionUpdate({ qr: "QR_DATA_123" });

    expect(onQr).toHaveBeenCalledWith("QR_DATA_123");

    // Close to settle the promise
    fireConnectionUpdate({ connection: "open" });
    await promise;
  });

  it("does not resolve on restartRequired close", async () => {
    const promise = startQrLogin({ authDir: "/tmp/wa-auth", timeout: 2000 });

    await vi.advanceTimersByTimeAsync(0);

    // restartRequired should not resolve
    fireConnectionUpdate({
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 515 } } },
    });

    // Advance past timeout to settle
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result).toBe(false); // timed out, not closed
    expect(mockEnd).toHaveBeenCalled();
  });

  it("renders QR to terminal when no onQr callback provided", async () => {
    const promise = startQrLogin({ authDir: "/tmp/wa-auth", timeout: 5000 });

    await vi.advanceTimersByTimeAsync(0);

    fireConnectionUpdate({ qr: "QR_TERMINAL_DATA" });

    expect(mockRenderQr).toHaveBeenCalledWith("QR_TERMINAL_DATA");

    // Settle
    fireConnectionUpdate({ connection: "open" });
    await promise;
  });

  it("does not render QR to terminal when onQr callback provided", async () => {
    const onQr = vi.fn();
    const promise = startQrLogin({ authDir: "/tmp/wa-auth", timeout: 5000, onQr });

    await vi.advanceTimersByTimeAsync(0);

    fireConnectionUpdate({ qr: "QR_CALLBACK_DATA" });

    expect(onQr).toHaveBeenCalledWith("QR_CALLBACK_DATA");
    expect(mockRenderQr).not.toHaveBeenCalled();

    // Settle
    fireConnectionUpdate({ connection: "open" });
    await promise;
  });

  it("wires creds.update to saveCreds", async () => {
    const promise = startQrLogin({ authDir: "/tmp/wa-auth", timeout: 5000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(eventHandlers.has("creds.update")).toBe(true);

    // Fire creds update
    const handlers = eventHandlers.get("creds.update") ?? [];
    for (const h of handlers) {
      h();
    }
    expect(mockSaveCreds).toHaveBeenCalled();

    // Settle
    fireConnectionUpdate({ connection: "open" });
    await promise;
  });
});
