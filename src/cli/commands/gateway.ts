import { loadAndValidateConfig } from "../../config/validation.js";
import { bootGateway } from "../../gateway/startup.js";
import { createLogger } from "../../infra/logger.js";

const logger = createLogger("gateway");

const SHUTDOWN_TIMEOUT_MS = 10_000;

export async function gatewayCommand(): Promise<void> {
  const config = await loadAndValidateConfig();
  const boot = await bootGateway(config);

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down...`);

    const forceTimer = setTimeout(() => {
      logger.warn("Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    try {
      await boot.stop();
    } catch (err) {
      logger.error("Error during shutdown", err);
    }
    clearTimeout(forceTimer);
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep alive
  console.log(`Jinx gateway running on ws://${config.gateway.host}:${config.gateway.port}`);
}
