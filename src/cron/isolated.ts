import { createLogger } from "../infra/logger.js";

const logger = createLogger("cron:isolated");

export interface IsolatedCronParams {
  prompt: string;
  agentId: string;
  sessionKey?: string;
  /** Function that runs a single agent turn and returns the result text. */
  runAgentTurn: (params: {
    prompt: string;
    agentId: string;
    sessionKey: string;
  }) => Promise<string>;
}

/**
 * Run a cron job in an isolated agent session.
 * Creates a throwaway session key so the cron turn doesn't pollute
 * any ongoing conversation.
 */
export async function runCronIsolatedAgentTurn(params: IsolatedCronParams): Promise<string> {
  const { prompt, agentId, runAgentTurn } = params;
  const sessionKey = params.sessionKey ?? `cron:${agentId}:${Date.now()}`;

  logger.info(`Running isolated cron turn: agent=${agentId} session=${sessionKey}`);

  const result = await runAgentTurn({ prompt, agentId, sessionKey });

  logger.debug(`Isolated turn completed (${result.length} chars)`);
  return result;
}
