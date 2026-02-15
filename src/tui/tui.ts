import readline from "node:readline";
import type { ChatClient } from "../gateway/chat-client.js";
import { createLogger } from "../infra/logger.js";
import { ChatLog } from "./chat-log.js";
import { executeTuiCommand, type TuiContext } from "./commands.js";
import { renderStatusBar, type StatusBarState } from "./status-bar.js";
import { StreamAssembler } from "./stream-assembler.js";

const logger = createLogger("tui");

/**
 * Run the interactive TUI chat loop.
 */
export async function runTui(chatClient: ChatClient, ctx?: TuiContext): Promise<void> {
  const chatLog = new ChatLog();
  const assembler = new StreamAssembler();
  let thinkingShown = false;

  const statusBar: StatusBarState = {
    connected: true,
    model: "claude",
    sessionKey: "",
    streaming: false,
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\njinx> ",
  });

  // Subscribe to chat events
  chatClient.onEvent((event) => {
    const text = assembler.process(event);

    if (event.type === "thinking" && !thinkingShown) {
      process.stdout.write("[thinking...] ");
      thinkingShown = true;
    } else if (event.type === "delta") {
      if (thinkingShown) {
        // Clear the thinking indicator before first delta
        process.stdout.write("\r\x1b[K");
        thinkingShown = false;
      }
      process.stdout.write(event.text);
    } else if (event.type === "final") {
      if (thinkingShown) {
        process.stdout.write("\r\x1b[K");
        thinkingShown = false;
      }
      process.stdout.write("\n");

      // Update token counts from usage data
      if (event.usage) {
        statusBar.tokenCount = {
          input: event.usage.inputTokens,
          output: event.usage.outputTokens,
        };
        statusBar.streaming = false;
        console.log(renderStatusBar(statusBar));
      }

      chatLog.add({ role: "assistant", text, timestamp: Date.now() });
      assembler.reset();
      rl.prompt();
    } else if (event.type === "aborted") {
      process.stdout.write(`\n[Aborted: ${event.reason}]\n`);
      thinkingShown = false;
      statusBar.streaming = false;
      assembler.reset();
      rl.prompt();
    }
  });

  console.log("Jinx TUI — type /help for commands, /quit to exit\n");
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Check for TUI commands
    const cmdResult = await executeTuiCommand(input, ctx);
    if (cmdResult.handled) {
      if (cmdResult.output) {
        console.log(cmdResult.output);
      }
      rl.prompt();
      return;
    }

    // Send as chat message
    chatLog.add({ role: "user", text: input, timestamp: Date.now() });
    statusBar.streaming = true;
    thinkingShown = false;
    process.stdout.write("\n");
    await chatClient.send(input);
  });

  rl.on("close", () => {
    logger.info("TUI closed");
    process.exit(0);
  });
}
