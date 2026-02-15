import { Command } from "commander";
import { execFile } from "node:child_process";
import { loadAndValidateConfig } from "../../config/validation.js";

/** Minimal typed interface for the Composio SDK subset we use in CLI. */
interface ComposioClient {
  authConfigs: {
    list(query?: { toolkit?: string }): Promise<{
      items: Array<{
        id: string;
        name: string;
        authScheme?: string;
        toolkit?: { slug: string };
      }>;
    }>;
    create(
      toolkit: string,
      options?: { type: string },
    ): Promise<{ id: string; authScheme: string }>;
  };
  connectedAccounts: {
    list(query?: { userIds?: string[] }): Promise<{
      items: Array<{
        id: string;
        toolkit?: { slug: string };
        status?: string;
      }>;
    }>;
    initiate(
      userId: string,
      authConfigId: string,
    ): Promise<{ redirectUrl?: string | null; id: string }>;
  };
}

async function createClient(apiKey: string): Promise<ComposioClient> {
  const { Composio } = await import("@composio/core");
  return new Composio({ apiKey }) as unknown as ComposioClient;
}

export const composioCommand = new Command("composio")
  .description("Manage Composio integrations")
  .addCommand(
    new Command("auth")
      .description("Authenticate with an external service via Composio")
      .argument("<toolkit>", "Service to authenticate (e.g. github, slack, gmail)")
      .action(async (toolkit: string) => {
        const config = await loadAndValidateConfig();

        if (!config.composio.enabled) {
          console.error(
            "Composio is not enabled. Add the following to ~/.jinx/config.yaml:\n\n  composio:\n    enabled: true",
          );
          process.exitCode = 1;
          return;
        }

        const apiKey = config.composio.apiKey || process.env.COMPOSIO_API_KEY;
        if (!apiKey) {
          console.error(
            "No Composio API key found. Set COMPOSIO_API_KEY in ~/.jinx/.env or configure composio.apiKey in ~/.jinx/config.yaml.",
          );
          process.exitCode = 1;
          return;
        }

        const userId = config.composio.userId;

        try {
          const client = await createClient(apiKey);

          console.log(`Looking up auth config for ${toolkit}...`);
          const existing = await client.authConfigs.list({ toolkit });
          let authConfigId = (existing.items ?? [])[0]?.id;
          if (!authConfigId) {
            console.log(`No auth config found, creating Composio-managed config...`);
            const created = await client.authConfigs.create(toolkit, {
              type: "use_composio_managed_auth",
            });
            authConfigId = created.id;
          }

          console.log(`Initiating OAuth for ${toolkit}...`);
          const connection = await client.connectedAccounts.initiate(userId, authConfigId);

          if (connection.redirectUrl) {
            console.log(`\nAuth URL: ${connection.redirectUrl}\n`);
            console.log("Opening browser...");
            openUrl(connection.redirectUrl);
          } else {
            console.log(`Connection initiated for ${toolkit}, but no redirect URL was returned.`);
          }
        } catch (err) {
          console.error(`Failed to initiate auth: ${err instanceof Error ? err.message : err}`);
          process.exitCode = 1;
        }
      }),
  )
  .addCommand(
    new Command("connections")
      .description("List active Composio service connections")
      .action(async () => {
        const config = await loadAndValidateConfig();

        const apiKey = config.composio.apiKey || process.env.COMPOSIO_API_KEY;
        if (!apiKey) {
          console.error(
            "No Composio API key found. Set COMPOSIO_API_KEY in ~/.jinx/.env or configure composio.apiKey in ~/.jinx/config.yaml.",
          );
          process.exitCode = 1;
          return;
        }

        const userId = config.composio.userId;

        try {
          const client = await createClient(apiKey);

          const result = await client.connectedAccounts.list({
            userIds: [userId],
          });

          const items = result.items ?? [];
          if (items.length === 0) {
            console.log("No connected services. Use `jinx composio auth <toolkit>` to connect.");
            return;
          }

          console.log(`Connected services (${items.length}):\n`);
          for (const item of items) {
            const status = item.status ?? "unknown";
            const toolkit = item.toolkit?.slug ?? "unknown";
            console.log(`  ${toolkit} [${status}]`);
          }
        } catch (err) {
          console.error(`Failed to list connections: ${err instanceof Error ? err.message : err}`);
          process.exitCode = 1;
        }
      }),
  );

function openUrl(url: string): void {
  const bin =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(bin, [url], () => {
    /* ignore errors — user can open manually */
  });
}
