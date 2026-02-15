import type { AgentToolDefinition } from "../../providers/types.js";
import { withTimeout } from "../../infra/timeout.js";

export interface ComposioToolContext {
  apiKey?: string;
  userId?: string;
  timeoutSeconds?: number;
}

// Lazy-loaded SDK client
let clientPromise: Promise<ComposioClient> | undefined;
let clientApiKey: string | undefined;

/** Raw tool shape returned by the Composio SDK. */
interface ComposioRawTool {
  name?: string;
  slug: string;
  description?: string;
  toolkit?: { name?: string; slug?: string };
}

/** Connected account shape returned by the Composio SDK. */
interface ComposioConnectedAccount {
  id: string;
  toolkit?: { slug: string };
  status?: string;
  createdAt?: string;
}

/** Minimal interface for the subset of the Composio SDK we use. */
interface ComposioClient {
  tools: {
    getRawComposioTools(query: {
      search?: string;
      toolkits?: string[];
      limit?: number;
    }): Promise<ComposioRawTool[]>;
    execute(
      slug: string,
      body: {
        userId: string;
        arguments: Record<string, unknown>;
        dangerouslySkipVersionCheck?: boolean;
      },
    ): Promise<{ data?: unknown; execution_id?: string }>;
  };
  connectedAccounts: {
    list(query?: {
      userIds?: string[];
      toolkitSlugs?: string[];
    }): Promise<{ items: ComposioConnectedAccount[] }>;
    initiate(
      userId: string,
      authConfigId: string,
    ): Promise<{ redirectUrl?: string | null; id: string }>;
  };
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
    ): Promise<{ id: string; authScheme: string; isComposioManaged: boolean; toolkit: string }>;
  };
  triggers: {
    create(
      userId: string,
      slug: string,
      body?: { triggerConfig?: Record<string, unknown> },
    ): Promise<{ id: string }>;
    listActive(query?: { userId?: string }): Promise<{
      triggers: Array<{ id: string; slug: string; status?: string; config?: unknown }>;
    }>;
    delete(triggerId: string): Promise<void>;
    subscribe(fn: (data: ComposioTriggerPayload) => void, filters?: object): Promise<void>;
    unsubscribe(): Promise<void>;
  };
}

/** Payload shape from Composio's Pusher-based trigger subscription. */
export interface ComposioTriggerPayload {
  triggerSlug?: string;
  triggerName?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function resolveApiKey(ctx: ComposioToolContext): string | undefined {
  return ctx.apiKey || process.env.COMPOSIO_API_KEY;
}

async function getClient(apiKey: string): Promise<ComposioClient> {
  if (clientPromise && clientApiKey === apiKey) {
    return clientPromise;
  }
  clientApiKey = apiKey;
  clientPromise = (async () => {
    const { Composio } = await import("@composio/core");
    return new Composio({ apiKey }) as unknown as ComposioClient;
  })();
  return clientPromise;
}

/** Reset the cached client — exposed for testing. */
export function resetComposioClient(): void {
  clientPromise = undefined;
  clientApiKey = undefined;
}

const NO_API_KEY_ERROR =
  "No Composio API key found. Set COMPOSIO_API_KEY in ~/.jinx/.env or configure composio.apiKey in ~/.jinx/config.yaml.";

/**
 * Score how well a tool matches a search query.
 * Composio's server-side search is unreliable, so we filter client-side.
 * Returns 0 (no match) to ~1 (strong match). Tokens are matched against
 * slug, name, and description.
 */
function scoreMatch(tool: ComposioRawTool, query: string): number {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) {
    return 1; // no filter → everything matches
  }

  const slug = (tool.slug ?? "").toLowerCase();
  const name = (tool.name ?? "").toLowerCase();
  const desc = (tool.description ?? "").toLowerCase();
  const haystack = `${slug} ${name} ${desc}`;

  let matched = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      matched++;
    }
  }
  return matched / tokens.length;
}

export function getComposioToolDefinitions(ctx: ComposioToolContext): AgentToolDefinition[] {
  const userId = ctx.userId ?? "default";
  const timeoutMs = (ctx.timeoutSeconds ?? 60) * 1000;

  return [
    // ── composio_search ─────────────────────────────────────────────
    {
      name: "composio_search",
      description:
        "Search Composio's 800+ tool integrations. Returns matching tools with their slugs (needed for composio_execute). Always provide the toolkit parameter to narrow results (e.g. toolkit='github', query='create issue'). Results are ranked by relevance to the query.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language search query (e.g. 'list github repos').",
          },
          toolkit: {
            type: "string",
            description: "Optional toolkit slug to filter by (e.g. 'github', 'slack', 'gmail').",
          },
          limit: {
            type: "number",
            description: "Max results to return (default: 10).",
          },
        },
        required: ["query"],
      },
      execute: async (input) => {
        const { query, toolkit, limit } = input as {
          query: string;
          toolkit?: string;
          limit?: number;
        };

        if (!query || !query.trim()) {
          return { error: "Search query cannot be empty." };
        }

        const apiKey = resolveApiKey(ctx);
        if (!apiKey) {
          return { error: NO_API_KEY_ERROR };
        }

        const desiredCount = limit ?? 10;

        try {
          const client = await getClient(apiKey);
          // Fetch extra results because server-side search is unreliable —
          // we filter client-side and return only the top matches.
          const rawTools = await withTimeout(
            client.tools.getRawComposioTools({
              search: query.trim(),
              toolkits: toolkit ? [toolkit] : undefined,
              limit: Math.max(desiredCount * 3, 30),
            }),
            timeoutMs,
            `Composio search timed out after ${ctx.timeoutSeconds ?? 60}s. The service may be slow. You can retry.`,
          );

          const scored = (rawTools ?? [])
            .map((t) => ({ tool: t, score: scoreMatch(t, query) }))
            .filter((s) => s.score > 0)
            .toSorted((a, b) => b.score - a.score)
            .slice(0, desiredCount);

          const tools = scored.map((s) => ({
            slug: s.tool.slug,
            name: s.tool.name ?? s.tool.slug,
            description: s.tool.description ?? "",
            toolkit: s.tool.toolkit?.slug ?? "",
          }));

          return {
            query,
            resultCount: tools.length,
            tools,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: `Search failed: ${message}` };
        }
      },
    },

    // ── composio_execute ────────────────────────────────────────────
    {
      name: "composio_execute",
      description:
        "Execute a Composio tool by its slug. Use composio_search first to find the slug. The service must be authenticated (use composio_check_connection to verify, composio_connect to authenticate).",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "The tool slug from composio_search (e.g. 'GITHUB_CREATE_ISSUE').",
          },
          arguments: {
            type: "object",
            description:
              "Arguments to pass to the tool. Check the tool description for required fields.",
          },
        },
        required: ["slug", "arguments"],
      },
      execute: async (input) => {
        const { slug, arguments: args } = input as {
          slug: string;
          arguments: Record<string, unknown>;
        };

        if (!slug || !slug.trim()) {
          return { error: "Tool slug cannot be empty." };
        }

        const apiKey = resolveApiKey(ctx);
        if (!apiKey) {
          return { error: NO_API_KEY_ERROR };
        }

        try {
          const client = await getClient(apiKey);
          const result = await withTimeout(
            client.tools.execute(slug.trim(), {
              userId,
              arguments: args ?? {},
              dangerouslySkipVersionCheck: true,
            }),
            timeoutMs,
            `Composio tool execution timed out after ${ctx.timeoutSeconds ?? 60}s for slug "${slug.trim()}". The external service may be slow. You can retry.`,
          );
          return { slug, success: true, data: result.data ?? result };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (
            message.toLowerCase().includes("not connected") ||
            message.toLowerCase().includes("no connected account") ||
            message.toLowerCase().includes("connected account not found")
          ) {
            const toolkit = slug.split("_")[0]?.toLowerCase();
            return {
              error: `Not authenticated with the required service. Use composio_connect with toolkit "${toolkit}" to set up authentication, then retry.`,
            };
          }
          return { error: `Tool execution failed: ${message}` };
        }
      },
    },

    // ── composio_connections ────────────────────────────────────────
    {
      name: "composio_connections",
      description:
        "List all authenticated Composio service connections. Shows which external services (GitHub, Slack, Gmail, etc.) are available for tool execution.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        const apiKey = resolveApiKey(ctx);
        if (!apiKey) {
          return { error: NO_API_KEY_ERROR };
        }

        try {
          const client = await getClient(apiKey);
          const result = await withTimeout(
            client.connectedAccounts.list({ userIds: [userId] }),
            timeoutMs,
            `Composio connections list timed out after ${ctx.timeoutSeconds ?? 60}s. You can retry.`,
          );

          const connections = (result.items ?? []).map((c) => ({
            id: c.id,
            toolkit: c.toolkit?.slug ?? "unknown",
            status: c.status ?? "unknown",
            createdAt: c.createdAt ?? "",
          }));

          return {
            connectionCount: connections.length,
            connections,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: `Failed to list connections: ${message}` };
        }
      },
    },

    // ── composio_connect ────────────────────────────────────────────
    {
      name: "composio_connect",
      description:
        "Generate an OAuth authentication URL for a Composio service. The user needs to visit the URL to authorize access. Use this when composio_check_connection shows a service is not connected.",
      inputSchema: {
        type: "object",
        properties: {
          toolkit: {
            type: "string",
            description: "Toolkit slug to connect (e.g. 'github', 'slack', 'gmail', 'notion').",
          },
        },
        required: ["toolkit"],
      },
      execute: async (input) => {
        const { toolkit } = input as { toolkit: string };

        if (!toolkit || !toolkit.trim()) {
          return { error: "Toolkit name cannot be empty." };
        }

        const apiKey = resolveApiKey(ctx);
        if (!apiKey) {
          return { error: NO_API_KEY_ERROR };
        }

        try {
          const client = await getClient(apiKey);
          const slug = toolkit.trim();

          // Find or create an auth config for this toolkit
          const existing = await withTimeout(
            client.authConfigs.list({ toolkit: slug }),
            timeoutMs,
            `Composio auth config lookup timed out after ${ctx.timeoutSeconds ?? 60}s. You can retry.`,
          );
          let authConfigId = (existing.items ?? [])[0]?.id;
          if (!authConfigId) {
            const created = await withTimeout(
              client.authConfigs.create(slug, {
                type: "use_composio_managed_auth",
              }),
              timeoutMs,
              `Composio auth config creation timed out after ${ctx.timeoutSeconds ?? 60}s. You can retry.`,
            );
            authConfigId = created.id;
          }

          const connection = await withTimeout(
            client.connectedAccounts.initiate(userId, authConfigId),
            timeoutMs,
            `Composio connection initiation timed out after ${ctx.timeoutSeconds ?? 60}s. You can retry.`,
          );
          return {
            toolkit: toolkit.trim(),
            authUrl: connection.redirectUrl ?? null,
            connectionId: connection.id,
            message: connection.redirectUrl
              ? `Visit this URL to authenticate with ${toolkit.trim()}: ${connection.redirectUrl}`
              : `Connection initiated for ${toolkit.trim()}, but no redirect URL was returned. The service may use a different auth flow.`,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: `Failed to initiate connection for ${toolkit.trim()}: ${message}` };
        }
      },
    },

    // ── composio_check_connection ───────────────────────────────────
    {
      name: "composio_check_connection",
      description:
        "Check if a specific service is authenticated and ready for use. Returns connection status for the given toolkit.",
      inputSchema: {
        type: "object",
        properties: {
          toolkit: {
            type: "string",
            description: "Toolkit slug to check (e.g. 'github', 'slack', 'gmail').",
          },
        },
        required: ["toolkit"],
      },
      execute: async (input) => {
        const { toolkit } = input as { toolkit: string };

        if (!toolkit || !toolkit.trim()) {
          return { error: "Toolkit name cannot be empty." };
        }

        const apiKey = resolveApiKey(ctx);
        if (!apiKey) {
          return { error: NO_API_KEY_ERROR };
        }

        try {
          const client = await getClient(apiKey);
          const result = await withTimeout(
            client.connectedAccounts.list({
              userIds: [userId],
              toolkitSlugs: [toolkit.trim()],
            }),
            timeoutMs,
            `Composio connection check timed out after ${ctx.timeoutSeconds ?? 60}s. You can retry.`,
          );

          const accounts = result.items ?? [];
          const active = accounts.find((a) => a.status?.toUpperCase() === "ACTIVE");

          return {
            toolkit: toolkit.trim(),
            connected: !!active,
            status: active ? "active" : accounts.length > 0 ? accounts[0].status : "not_connected",
            accountId: active?.id ?? null,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: `Failed to check connection: ${message}` };
        }
      },
    },

    // ── composio_trigger_create ──────────────────────────────────────
    {
      name: "composio_trigger_create",
      description:
        "Subscribe to real-time events from a connected service (e.g. new Linear issues, GitHub commits, Gmail emails). Events are delivered via the heartbeat system.",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "The trigger slug (e.g. 'GITHUB_COMMIT_EVENT', 'LINEAR_ISSUE_CREATED').",
          },
          config: {
            type: "object",
            description:
              "Trigger-specific configuration (e.g. { owner: 'org', repo: 'name' } for GitHub).",
          },
        },
        required: ["slug"],
      },
      execute: async (input) => {
        const { slug, config } = input as {
          slug: string;
          config?: Record<string, unknown>;
        };

        if (!slug || !slug.trim()) {
          return { error: "Trigger slug cannot be empty." };
        }

        const apiKey = resolveApiKey(ctx);
        if (!apiKey) {
          return { error: NO_API_KEY_ERROR };
        }

        try {
          const client = await getClient(apiKey);
          const result = await withTimeout(
            client.triggers.create(userId, slug.trim(), {
              triggerConfig: config,
            }),
            timeoutMs,
            `Composio trigger creation timed out after ${ctx.timeoutSeconds ?? 60}s. You can retry.`,
          );
          return {
            slug: slug.trim(),
            triggerId: result.id,
            message: `Trigger "${slug.trim()}" created. Events will be delivered via heartbeat.`,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: `Failed to create trigger: ${message}` };
        }
      },
    },

    // ── composio_trigger_list ────────────────────────────────────────
    {
      name: "composio_trigger_list",
      description: "List active Composio trigger subscriptions.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        const apiKey = resolveApiKey(ctx);
        if (!apiKey) {
          return { error: NO_API_KEY_ERROR };
        }

        try {
          const client = await getClient(apiKey);
          const result = await withTimeout(
            client.triggers.listActive({ userId }),
            timeoutMs,
            `Composio trigger list timed out after ${ctx.timeoutSeconds ?? 60}s. You can retry.`,
          );

          const triggers = (result.triggers ?? []).map((t) => ({
            id: t.id,
            slug: t.slug,
            status: t.status ?? "unknown",
          }));

          return {
            triggerCount: triggers.length,
            triggers,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: `Failed to list triggers: ${message}` };
        }
      },
    },

    // ── composio_trigger_delete ──────────────────────────────────────
    {
      name: "composio_trigger_delete",
      description: "Remove a Composio trigger subscription.",
      inputSchema: {
        type: "object",
        properties: {
          triggerId: {
            type: "string",
            description: "The trigger ID to delete (from composio_trigger_list).",
          },
        },
        required: ["triggerId"],
      },
      execute: async (input) => {
        const { triggerId } = input as { triggerId: string };

        if (!triggerId || !triggerId.trim()) {
          return { error: "Trigger ID cannot be empty." };
        }

        const apiKey = resolveApiKey(ctx);
        if (!apiKey) {
          return { error: NO_API_KEY_ERROR };
        }

        try {
          const client = await getClient(apiKey);
          await withTimeout(
            client.triggers.delete(triggerId.trim()),
            timeoutMs,
            `Composio trigger deletion timed out after ${ctx.timeoutSeconds ?? 60}s. You can retry.`,
          );
          return {
            triggerId: triggerId.trim(),
            message: `Trigger "${triggerId.trim()}" deleted.`,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: `Failed to delete trigger: ${message}` };
        }
      },
    },
  ];
}
