import fs from "node:fs";
import path from "node:path";
import { resolveHomeDir } from "./home-dir.js";
import { createLogger } from "./logger.js";
import { SECURE_FILE_MODE } from "./security.js";

const logger = createLogger("product-telemetry");
const PRODUCT_TELEMETRY_FILENAME = "product-telemetry.jsonl";

function shouldSkipTelemetryWriteInTests(): boolean {
  const inVitest =
    process.env.VITEST === "true" ||
    process.env.VITEST === "1" ||
    process.env.VITEST_WORKER_ID !== undefined;
  return inVitest && !process.env.JINX_HOME;
}

export interface ProductTelemetryEvent {
  timestamp: number;
  area: "marathon" | "delivery";
  event: string;
  [key: string]: unknown;
}

interface ProductTelemetryInput {
  area: ProductTelemetryEvent["area"];
  event: string;
  timestamp?: number;
  [key: string]: unknown;
}

export function getProductTelemetryPath(): string {
  return path.join(resolveHomeDir(), PRODUCT_TELEMETRY_FILENAME);
}

export function logProductTelemetry(event: ProductTelemetryInput): void {
  if (shouldSkipTelemetryWriteInTests()) {
    return;
  }
  try {
    const { timestamp, area, event: eventName, ...metadata } = event;
    const normalized: ProductTelemetryEvent = {
      timestamp: timestamp ?? Date.now(),
      area,
      event: eventName,
      ...metadata,
    };
    fs.appendFileSync(getProductTelemetryPath(), `${JSON.stringify(normalized)}\n`, {
      mode: SECURE_FILE_MODE,
    });
  } catch (err) {
    logger.warn(`Failed to write product telemetry event: ${err}`);
  }
}

export async function readProductTelemetry(since?: number): Promise<ProductTelemetryEvent[]> {
  const filePath = getProductTelemetryPath();
  let data: string;
  try {
    data = await fs.promises.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const events: ProductTelemetryEvent[] = [];
  for (const line of data.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as ProductTelemetryEvent;
      if (typeof parsed.timestamp !== "number" || typeof parsed.event !== "string") {
        continue;
      }
      if (since === undefined || parsed.timestamp >= since) {
        events.push(parsed);
      }
    } catch {
      logger.debug(`Skipping malformed telemetry line: ${line.slice(0, 80)}`);
    }
  }

  return events;
}
