import type { TuiContext } from "../../tui/commands.js";
import { loadAndValidateConfig } from "../../config/validation.js";
import { createChatClient } from "../../gateway/chat-client.js";
import { createGatewayClient } from "../../gateway/client.js";
import { bootGateway } from "../../gateway/startup.js";
import { runTui } from "../../tui/tui.js";

export async function chatCommand(): Promise<void> {
  const config = await loadAndValidateConfig();

  // Start gateway in-process
  const boot = await bootGateway(config);

  // Connect TUI client
  const gatewayUrl = `ws://${config.gateway.host}:${config.gateway.port}`;
  const client = createGatewayClient(gatewayUrl);
  await client.connect();

  const chatClient = createChatClient(client);

  // Handle shutdown
  process.on("SIGINT", async () => {
    client.disconnect();
    await boot.stop();
    process.exit(0);
  });

  const tuiCtx: TuiContext = {
    config: boot.config,
    sessions: boot.sessions,
    channels: boot.channels,
    searchManager: boot.searchManager,
  };
  await runTui(chatClient, tuiCtx);
}
