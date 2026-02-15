import chalk from "chalk";

export interface StatusBarState {
  connected: boolean;
  model: string;
  sessionKey: string;
  tokenCount?: { input: number; output: number };
  streaming: boolean;
}

/**
 * Render the status bar for the TUI.
 */
export function renderStatusBar(state: StatusBarState): string {
  const parts: string[] = [];

  // Connection status
  parts.push(state.connected ? chalk.green("connected") : chalk.red("disconnected"));

  // Model
  parts.push(chalk.cyan(state.model));

  // Session
  parts.push(chalk.dim(state.sessionKey));

  // Token count
  if (state.tokenCount) {
    parts.push(chalk.dim(`${state.tokenCount.input}/${state.tokenCount.output} tokens`));
  }

  // Streaming indicator
  if (state.streaming) {
    parts.push(chalk.yellow("streaming..."));
  }

  return parts.join(chalk.dim(" | "));
}
