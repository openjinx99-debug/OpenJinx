import type { JinxConfig } from "../types/config.js";
import type { ChannelId } from "../types/config.js";
import type { SessionStore, SessionEntry } from "../types/sessions.js";
import { createTestConfig } from "./config.js";
import { createMockChannel, type MockChannel } from "./mock-channel.js";
import { createMockClaudeSdk, type MockClaudeSdk } from "./mock-claude-sdk.js";
import { createTestWorkspace, type TestWorkspace } from "./workspace.js";

/**
 * System test harness: wires mock SDK + mock channel + real workspace
 * together for full end-to-end flow testing.
 */
export interface TestHarness {
  /** Mock Claude SDK for controlling agent responses. */
  sdk: MockClaudeSdk;
  /** Mock channel adapter for capturing deliveries. */
  channel: MockChannel;
  /** Temporary workspace with real files. */
  workspace: TestWorkspace;
  /** Merged test config. */
  config: JinxConfig;
  /** In-memory session store. */
  sessions: SessionStore;
  /** Clean up all resources. */
  cleanup: () => Promise<void>;
}

/**
 * Create a fully wired test harness for system tests.
 * All internal logic runs for real; only the Claude SDK and external I/O are mocked.
 */
export async function createTestHarness(opts?: {
  configOverrides?: Parameters<typeof createTestConfig>[0];
  channelId?: ChannelId;
  workspaceOverrides?: Record<string, string>;
}): Promise<TestHarness> {
  const sdk = createMockClaudeSdk();
  const channel = createMockChannel(opts?.channelId ?? "telegram");
  const workspace = await createTestWorkspace(opts?.workspaceOverrides);

  const config = createTestConfig({
    ...opts?.configOverrides,
    agents: {
      default: "default",
      list: [
        {
          id: "default",
          name: "TestJinx",
          workspace: workspace.dir,
        },
      ],
    },
    memory: {
      enabled: true,
      dir: workspace.memoryDir,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      vectorWeight: 0.7,
      maxResults: 10,
    },
  });

  // In-memory session store
  const entries = new Map<string, SessionEntry>();
  const sessions: SessionStore = {
    get: (key) => entries.get(key),
    set: (key, entry) => entries.set(key, entry),
    delete: (key) => entries.delete(key),
    list: () => [...entries.values()],
    save: async () => {},
    load: async () => {},
  };

  return {
    sdk,
    channel,
    workspace,
    config,
    sessions,
    async cleanup() {
      sdk.reset();
      channel.reset();
      await workspace.cleanup();
    },
  };
}
