import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    pool: "forks",
    include: ["src/**/*.test.ts"],
    exclude: [
      "dist/**",
      "**/*.live.test.ts",
      "**/*.e2e.test.ts",
      "src/__integration__/**",
      "src/**/__integration__/**",
      "src/__system__/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 55,
        statements: 70,
      },
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/entry.ts",
        "src/index.ts",
        "src/cli/**",
        "src/tui/**",
        "src/types/**",
        // Gateway & channel adapters require external connections
        "src/gateway/server.ts",
        "src/gateway/client.ts",
        "src/gateway/chat-client.ts",
        "src/gateway/startup.ts",
        "src/gateway/protocol.ts",
        "src/channels/telegram/bot.ts",
        "src/channels/telegram/handlers.ts",
        "src/channels/telegram/dispatch.ts",
        "src/channels/telegram/send.ts",
        "src/channels/telegram/streaming.ts",
        "src/channels/telegram/access.ts",
        "src/channels/telegram/monitor.ts",
        "src/channels/telegram/media.ts",
        "src/channels/telegram/context.ts",
        "src/channels/telegram/config.ts",
        "src/channels/whatsapp/session.ts",
        "src/channels/whatsapp/login-qr.ts",
        "src/channels/whatsapp/monitor.ts",
        "src/channels/whatsapp/context.ts",
        "src/channels/whatsapp/send.ts",
        "src/channels/whatsapp/media.ts",
        "src/channels/whatsapp/access.ts",
        "src/channels/whatsapp/config.ts",
        // Provider stubs require real SDK
        "src/providers/claude-provider.ts",
        "src/providers/types.ts",
        // Memory modules requiring SQLite/embeddings
        "src/memory/schema.ts",
        "src/memory/embeddings.ts",
        "src/memory/index-manager.ts",
        "src/memory/search-manager.ts",
        // Pipeline dispatch requires full agent runtime
        "src/pipeline/dispatch.ts",
        // Re-export only modules
        "src/cron/types.ts",
        // Test helpers (not production code)
        "src/__test__/**",
      ],
    },
  },
});
