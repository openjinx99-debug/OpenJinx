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
  logger.error("Uncaught exception — shutting down", err);
  process.exit(1);
});

const program = createCli();
program.parse();
