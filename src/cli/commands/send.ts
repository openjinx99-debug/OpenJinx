import { Command } from "commander";
import { randomUUID } from "node:crypto";
import type { GatewayMessage } from "../../gateway/protocol.js";
import { loadAndValidateConfig } from "../../config/validation.js";
import { createGatewayClient } from "../../gateway/client.js";

export const sendCommand = new Command("send")
  .description("Send a message from the command line")
  .argument("<message>", "Message to send")
  .option("-s, --session <key>", "Session key")
  .action(async (message: string, opts: { session?: string }) => {
    let config;
    try {
      config = await loadAndValidateConfig();
    } catch (err) {
      console.error("Config error:", err instanceof Error ? err.message : err);
      process.exit(1);
    }

    const { host, port } = config.gateway;
    const url = `ws://${host}:${port}`;
    const sessionKey = opts.session ?? `cli:send:${Date.now()}`;
    const msgId = randomUUID();

    const RESPONSE_TIMEOUT_MS = 120_000;
    const client = createGatewayClient(url);

    let responseTimer: ReturnType<typeof setTimeout> | undefined;

    client.onMessage((msg: GatewayMessage) => {
      if (msg.type === "chat.final") {
        if (responseTimer) {
          clearTimeout(responseTimer);
        }
        console.log(msg.text);
        client.disconnect();
      } else if (msg.type === "chat.aborted") {
        if (responseTimer) {
          clearTimeout(responseTimer);
        }
        console.error("Aborted:", msg.reason);
        client.disconnect();
        process.exit(1);
      }
    });

    await client.connect();

    responseTimer = setTimeout(() => {
      console.error("Timed out waiting for response");
      client.disconnect();
      process.exit(1);
    }, RESPONSE_TIMEOUT_MS);
    responseTimer.unref();

    client.send({
      type: "chat.send",
      id: msgId,
      sessionKey,
      text: message,
    });
  });
