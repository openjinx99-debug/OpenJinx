#!/usr/bin/env node

import { createCli } from "./cli/index.js";
import { loadDotEnv } from "./infra/dotenv.js";
import { createLogger } from "./infra/logger.js";

loadDotEnv();

const logger = createLogger("process");

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", reason);
});

process.on("uncaughtException", (err) => {
  // Composio's Pusher client throws async errors on network reconnect that
  // escape our try/catch in trigger-subscriber.ts.  These are transient and
  // should not take down the whole process.
  if (isComposioTransientError(err)) {
    logger.warn("Composio transient error (non-fatal)", err);
    return;
  }

  logger.error("Uncaught exception — shutting down", err);
  process.exit(1);
});

function isComposioTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const code = (err as { code?: string }).code ?? "";
  return code.startsWith("TS-SDK::TRIGGER_") || err.name.startsWith("Composio");
}

const program = createCli();
program.parse();
