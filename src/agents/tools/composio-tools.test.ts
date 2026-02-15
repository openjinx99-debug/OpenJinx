import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getComposioToolDefinitions, resetComposioClient } from "./composio-tools.js";

// ── Mock the Composio SDK ────────────────────────────────────────────────

const mockGetRawComposioTools = vi.fn();
const mockExecute = vi.fn();
const mockListConnectedAccounts = vi.fn();
const mockInitiateConnection = vi.fn();
const mockListAuthConfigs = vi.fn();
const mockCreateAuthConfig = vi.fn();
const mockTriggerCreate = vi.fn();
const mockTriggerListActive = vi.fn();
const mockTriggerDelete = vi.fn();
const mockTriggerSubscribe = vi.fn();
const mockTriggerUnsubscribe = vi.fn();

vi.mock("@composio/core", () => ({
  Composio: class MockComposio {
    tools = {
      getRawComposioTools: mockGetRawComposioTools,
      execute: mockExecute,
    };
    connectedAccounts = {
      list: mockListConnectedAccounts,
      initiate: mockInitiateConnection,
    };
    authConfigs = {
      list: mockListAuthConfigs,
      create: mockCreateAuthConfig,
    };
    triggers = {
      create: mockTriggerCreate,
      listActive: mockTriggerListActive,
      delete: mockTriggerDelete,
      subscribe: mockTriggerSubscribe,
      unsubscribe: mockTriggerUnsubscribe,
    };
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────

function findTool(name: string, ctx: Parameters<typeof getComposioToolDefinitions>[0] = {}) {
  const tools = getComposioToolDefinitions(ctx);
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not found`);
  }
  return tool;
}

describe("composio-tools", () => {
  beforeEach(() => {
    resetComposioClient();
    vi.stubEnv("COMPOSIO_API_KEY", "");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Factory ───────────────────────────────────────────────────────

  it("returns exactly 8 tools with correct names", () => {
    const tools = getComposioToolDefinitions({});
    expect(tools).toHaveLength(8);
    expect(tools.map((t) => t.name)).toEqual([
      "composio_search",
      "composio_execute",
      "composio_connections",
      "composio_connect",
      "composio_check_connection",
      "composio_trigger_create",
      "composio_trigger_list",
      "composio_trigger_delete",
    ]);
  });

  // ── API key errors ────────────────────────────────────────────────

  it.each([
    "composio_search",
    "composio_execute",
    "composio_connections",
    "composio_connect",
    "composio_check_connection",
    "composio_trigger_create",
    "composio_trigger_list",
    "composio_trigger_delete",
  ])("%s returns error when no API key is set", async (toolName) => {
    const tool = findTool(toolName);
    const input =
      toolName === "composio_search"
        ? { query: "test" }
        : toolName === "composio_execute"
          ? { slug: "TEST_TOOL", arguments: {} }
          : toolName === "composio_connections" || toolName === "composio_trigger_list"
            ? {}
            : toolName === "composio_trigger_create"
              ? { slug: "TEST_TRIGGER" }
              : toolName === "composio_trigger_delete"
                ? { triggerId: "tr-1" }
                : { toolkit: "github" };
    const result = (await tool.execute(input)) as { error: string };
    expect(result.error).toContain("No Composio API key found");
    expect(result.error).toContain("COMPOSIO_API_KEY");
  });

  it("uses COMPOSIO_API_KEY from environment", async () => {
    vi.stubEnv("COMPOSIO_API_KEY", "test-env-key");
    mockGetRawComposioTools.mockResolvedValue([]);

    const tool = findTool("composio_search");
    const result = (await tool.execute({ query: "test" })) as { resultCount: number };
    expect(result.resultCount).toBe(0);
    expect(mockGetRawComposioTools).toHaveBeenCalledTimes(1);
  });

  // ── composio_search ───────────────────────────────────────────────

  describe("composio_search", () => {
    it("returns formatted results", async () => {
      mockGetRawComposioTools.mockResolvedValue([
        {
          slug: "GITHUB_CREATE_ISSUE",
          name: "Create Issue",
          description: "Create a new GitHub issue",
          toolkit: { name: "GitHub", slug: "github" },
        },
        {
          slug: "GITHUB_LIST_REPOS",
          name: "List Repos",
          description: "List repositories",
          toolkit: { name: "GitHub", slug: "github" },
        },
      ]);

      const tool = findTool("composio_search", { apiKey: "test-key" });
      const result = (await tool.execute({ query: "github issue" })) as {
        query: string;
        resultCount: number;
        tools: Array<{ slug: string; name: string }>;
      };

      expect(result.query).toBe("github issue");
      expect(result.resultCount).toBe(2);
      expect(result.tools[0].slug).toBe("GITHUB_CREATE_ISSUE");
      expect(result.tools[0].name).toBe("Create Issue");
      expect(result.tools[1].slug).toBe("GITHUB_LIST_REPOS");
    });

    it("passes toolkit filter when provided", async () => {
      mockGetRawComposioTools.mockResolvedValue([]);

      const tool = findTool("composio_search", { apiKey: "test-key" });
      await tool.execute({ query: "send message", toolkit: "slack", limit: 5 });

      // Fetches extra results for client-side filtering (max(limit*3, 30))
      expect(mockGetRawComposioTools).toHaveBeenCalledWith({
        search: "send message",
        toolkits: ["slack"],
        limit: 30,
      });
    });

    it("filters and ranks results client-side", async () => {
      mockGetRawComposioTools.mockResolvedValue([
        {
          slug: "GITHUB_LIST_REPOS",
          name: "List Repos",
          description: "List all repositories",
          toolkit: { name: "GitHub", slug: "github" },
        },
        {
          slug: "GITHUB_CREATE_ISSUE",
          name: "Create Issue",
          description: "Create a new GitHub issue",
          toolkit: { name: "GitHub", slug: "github" },
        },
        {
          slug: "GITHUB_STAR_REPO",
          name: "Star Repo",
          description: "Star a repository",
          toolkit: { name: "GitHub", slug: "github" },
        },
      ]);

      const tool = findTool("composio_search", { apiKey: "test-key" });
      const result = (await tool.execute({ query: "create issue" })) as {
        resultCount: number;
        tools: Array<{ slug: string }>;
      };

      // "Create Issue" matches both tokens, should rank first
      expect(result.tools[0].slug).toBe("GITHUB_CREATE_ISSUE");
      // Others may partially match or not — just check the best is first
      expect(result.resultCount).toBeGreaterThanOrEqual(1);
    });

    it("returns empty when no tools match query", async () => {
      mockGetRawComposioTools.mockResolvedValue([
        {
          slug: "GITHUB_LIST_REPOS",
          name: "List Repos",
          description: "List all repositories",
          toolkit: { name: "GitHub", slug: "github" },
        },
      ]);

      const tool = findTool("composio_search", { apiKey: "test-key" });
      const result = (await tool.execute({ query: "zzz nonexistent" })) as {
        resultCount: number;
      };

      expect(result.resultCount).toBe(0);
    });

    it("handles SDK errors gracefully", async () => {
      mockGetRawComposioTools.mockRejectedValue(new Error("Network timeout"));

      const tool = findTool("composio_search", { apiKey: "test-key" });
      const result = (await tool.execute({ query: "github" })) as { error: string };
      expect(result.error).toContain("Search failed");
      expect(result.error).toContain("Network timeout");
    });

    it("rejects empty query", async () => {
      const tool = findTool("composio_search", { apiKey: "test-key" });
      const result = (await tool.execute({ query: "" })) as { error: string };
      expect(result.error).toContain("cannot be empty");
    });

    it("rejects whitespace-only query", async () => {
      const tool = findTool("composio_search", { apiKey: "test-key" });
      const result = (await tool.execute({ query: "   " })) as { error: string };
      expect(result.error).toContain("cannot be empty");
    });
  });

  // ── composio_execute ──────────────────────────────────────────────

  describe("composio_execute", () => {
    it("returns success result", async () => {
      mockExecute.mockResolvedValue({
        data: { issue_number: 42, url: "https://github.com/org/repo/issues/42" },
      });

      const tool = findTool("composio_execute", { apiKey: "test-key" });
      const result = (await tool.execute({
        slug: "GITHUB_CREATE_ISSUE",
        arguments: { title: "Bug fix", body: "Details..." },
      })) as { slug: string; success: boolean; data: unknown };

      expect(result.success).toBe(true);
      expect(result.slug).toBe("GITHUB_CREATE_ISSUE");
      expect(result.data).toEqual({
        issue_number: 42,
        url: "https://github.com/org/repo/issues/42",
      });
    });

    it("rejects empty slug", async () => {
      const tool = findTool("composio_execute", { apiKey: "test-key" });
      const result = (await tool.execute({ slug: "", arguments: {} })) as { error: string };
      expect(result.error).toContain("cannot be empty");
    });

    it("detects auth errors with helpful message", async () => {
      mockExecute.mockRejectedValue(new Error("No connected account found for this toolkit"));

      const tool = findTool("composio_execute", { apiKey: "test-key" });
      const result = (await tool.execute({
        slug: "GITHUB_CREATE_ISSUE",
        arguments: {},
      })) as { error: string };

      expect(result.error).toContain("Not authenticated");
      expect(result.error).toContain("composio_connect");
      expect(result.error).toContain("github");
    });

    it("returns generic error for other failures", async () => {
      mockExecute.mockRejectedValue(new Error("Rate limit exceeded"));

      const tool = findTool("composio_execute", { apiKey: "test-key" });
      const result = (await tool.execute({
        slug: "GITHUB_CREATE_ISSUE",
        arguments: {},
      })) as { error: string };

      expect(result.error).toContain("Tool execution failed");
      expect(result.error).toContain("Rate limit exceeded");
    });

    it("uses configured userId", async () => {
      mockExecute.mockResolvedValue({ data: {} });

      const tool = findTool("composio_execute", { apiKey: "test-key", userId: "tommy" });
      await tool.execute({ slug: "TEST_TOOL", arguments: { foo: "bar" } });

      expect(mockExecute).toHaveBeenCalledWith("TEST_TOOL", {
        userId: "tommy",
        arguments: { foo: "bar" },
        dangerouslySkipVersionCheck: true,
      });
    });
  });

  // ── composio_connections ──────────────────────────────────────────

  describe("composio_connections", () => {
    it("returns formatted connections", async () => {
      mockListConnectedAccounts.mockResolvedValue({
        items: [
          {
            id: "conn-1",
            toolkit: { slug: "github" },
            status: "ACTIVE",
            createdAt: "2025-01-01T00:00:00Z",
          },
          {
            id: "conn-2",
            toolkit: { slug: "slack" },
            status: "ACTIVE",
            createdAt: "2025-01-02T00:00:00Z",
          },
        ],
      });

      const tool = findTool("composio_connections", { apiKey: "test-key" });
      const result = (await tool.execute({})) as {
        connectionCount: number;
        connections: Array<{ id: string; toolkit: string; status: string }>;
      };

      expect(result.connectionCount).toBe(2);
      expect(result.connections[0].toolkit).toBe("github");
      expect(result.connections[1].toolkit).toBe("slack");
    });

    it("handles empty list", async () => {
      mockListConnectedAccounts.mockResolvedValue({ items: [] });

      const tool = findTool("composio_connections", { apiKey: "test-key" });
      const result = (await tool.execute({})) as { connectionCount: number };
      expect(result.connectionCount).toBe(0);
    });

    it("handles SDK errors gracefully", async () => {
      mockListConnectedAccounts.mockRejectedValue(new Error("API unavailable"));

      const tool = findTool("composio_connections", { apiKey: "test-key" });
      const result = (await tool.execute({})) as { error: string };
      expect(result.error).toContain("Failed to list connections");
    });
  });

  // ── composio_connect ──────────────────────────────────────────────

  describe("composio_connect", () => {
    it("returns auth URL", async () => {
      mockListAuthConfigs.mockResolvedValue({
        items: [{ id: "auth-config-1", name: "GitHub OAuth", authScheme: "OAUTH2" }],
      });
      mockInitiateConnection.mockResolvedValue({
        id: "conn-req-1",
        redirectUrl: "https://github.com/login/oauth/authorize?client_id=abc",
      });

      const tool = findTool("composio_connect", { apiKey: "test-key" });
      const result = (await tool.execute({ toolkit: "github" })) as {
        toolkit: string;
        authUrl: string;
        connectionId: string;
        message: string;
      };

      expect(result.toolkit).toBe("github");
      expect(result.authUrl).toBe("https://github.com/login/oauth/authorize?client_id=abc");
      expect(result.connectionId).toBe("conn-req-1");
      expect(result.message).toContain("Visit this URL");
    });

    it("rejects empty toolkit", async () => {
      const tool = findTool("composio_connect", { apiKey: "test-key" });
      const result = (await tool.execute({ toolkit: "" })) as { error: string };
      expect(result.error).toContain("cannot be empty");
    });

    it("handles SDK errors gracefully", async () => {
      mockListAuthConfigs.mockRejectedValue(new Error("Service down"));

      const tool = findTool("composio_connect", { apiKey: "test-key" });
      const result = (await tool.execute({ toolkit: "github" })) as { error: string };
      expect(result.error).toContain("Failed to initiate connection");
      expect(result.error).toContain("Service down");
    });

    it("auto-creates auth config when none exists", async () => {
      mockListAuthConfigs.mockResolvedValue({ items: [] });
      mockCreateAuthConfig.mockResolvedValue({
        id: "ac_new",
        authScheme: "OAUTH2",
        isComposioManaged: true,
        toolkit: "github",
      });
      mockInitiateConnection.mockResolvedValue({
        id: "conn-req-2",
        redirectUrl: "https://example.com/oauth",
      });

      const tool = findTool("composio_connect", { apiKey: "test-key" });
      const result = (await tool.execute({ toolkit: "github" })) as {
        toolkit: string;
        authUrl: string;
        connectionId: string;
      };

      expect(mockCreateAuthConfig).toHaveBeenCalledWith("github", {
        type: "use_composio_managed_auth",
      });
      expect(result.authUrl).toBe("https://example.com/oauth");
      expect(result.connectionId).toBe("conn-req-2");
    });
  });

  // ── composio_check_connection ─────────────────────────────────────

  describe("composio_check_connection", () => {
    it("returns connected=true for active connection", async () => {
      mockListConnectedAccounts.mockResolvedValue({
        items: [{ id: "conn-1", toolkit: { slug: "github" }, status: "ACTIVE" }],
      });

      const tool = findTool("composio_check_connection", { apiKey: "test-key" });
      const result = (await tool.execute({ toolkit: "github" })) as {
        toolkit: string;
        connected: boolean;
        status: string;
        accountId: string;
      };

      expect(result.toolkit).toBe("github");
      expect(result.connected).toBe(true);
      expect(result.status).toBe("active");
      expect(result.accountId).toBe("conn-1");
    });

    it("returns connected=false when not connected", async () => {
      mockListConnectedAccounts.mockResolvedValue({ items: [] });

      const tool = findTool("composio_check_connection", { apiKey: "test-key" });
      const result = (await tool.execute({ toolkit: "github" })) as {
        connected: boolean;
        status: string;
        accountId: null;
      };

      expect(result.connected).toBe(false);
      expect(result.status).toBe("not_connected");
      expect(result.accountId).toBeNull();
    });

    it("returns connected=false for inactive connection", async () => {
      mockListConnectedAccounts.mockResolvedValue({
        items: [{ id: "conn-1", toolkit: { slug: "github" }, status: "EXPIRED" }],
      });

      const tool = findTool("composio_check_connection", { apiKey: "test-key" });
      const result = (await tool.execute({ toolkit: "github" })) as {
        connected: boolean;
        status: string;
      };

      expect(result.connected).toBe(false);
      expect(result.status).toBe("EXPIRED");
    });

    it("handles SDK errors gracefully", async () => {
      mockListConnectedAccounts.mockRejectedValue(new Error("Timeout"));

      const tool = findTool("composio_check_connection", { apiKey: "test-key" });
      const result = (await tool.execute({ toolkit: "github" })) as { error: string };
      expect(result.error).toContain("Failed to check connection");
    });

    it("rejects empty toolkit", async () => {
      const tool = findTool("composio_check_connection", { apiKey: "test-key" });
      const result = (await tool.execute({ toolkit: "" })) as { error: string };
      expect(result.error).toContain("cannot be empty");
    });
  });

  // ── Timeout tests ─────────────────────────────────────────────────

  describe("timeouts", () => {
    const ctx = { apiKey: "test-key", timeoutSeconds: 0.05 };

    it("composio_search times out on slow SDK call", async () => {
      mockGetRawComposioTools.mockReturnValue(new Promise(() => {}));
      const tool = findTool("composio_search", ctx);
      const result = (await tool.execute({ query: "test" })) as { error: string };
      expect(result.error).toContain("timed out");
    });

    it("composio_execute times out on slow SDK call", async () => {
      mockExecute.mockReturnValue(new Promise(() => {}));
      const tool = findTool("composio_execute", ctx);
      const result = (await tool.execute({ slug: "TEST_TOOL", arguments: {} })) as {
        error: string;
      };
      expect(result.error).toContain("timed out");
      expect(result.error).toContain("TEST_TOOL");
    });

    it("composio_connections times out on slow SDK call", async () => {
      mockListConnectedAccounts.mockReturnValue(new Promise(() => {}));
      const tool = findTool("composio_connections", ctx);
      const result = (await tool.execute({})) as { error: string };
      expect(result.error).toContain("timed out");
    });

    it("composio_connect times out on slow authConfigs.list", async () => {
      mockListAuthConfigs.mockReturnValue(new Promise(() => {}));
      const tool = findTool("composio_connect", ctx);
      const result = (await tool.execute({ toolkit: "github" })) as { error: string };
      expect(result.error).toContain("timed out");
    });

    it("composio_connect times out on slow connectedAccounts.initiate", async () => {
      mockListAuthConfigs.mockResolvedValue({ items: [{ id: "ac-1" }] });
      mockInitiateConnection.mockReturnValue(new Promise(() => {}));
      const tool = findTool("composio_connect", ctx);
      const result = (await tool.execute({ toolkit: "github" })) as { error: string };
      expect(result.error).toContain("timed out");
    });

    it("composio_check_connection times out on slow SDK call", async () => {
      mockListConnectedAccounts.mockReturnValue(new Promise(() => {}));
      const tool = findTool("composio_check_connection", ctx);
      const result = (await tool.execute({ toolkit: "github" })) as { error: string };
      expect(result.error).toContain("timed out");
    });

    it("composio_trigger_create times out on slow SDK call", async () => {
      mockTriggerCreate.mockReturnValue(new Promise(() => {}));
      const tool = findTool("composio_trigger_create", ctx);
      const result = (await tool.execute({ slug: "LINEAR_ISSUE_CREATED" })) as { error: string };
      expect(result.error).toContain("timed out");
    });

    it("composio_trigger_list times out on slow SDK call", async () => {
      mockTriggerListActive.mockReturnValue(new Promise(() => {}));
      const tool = findTool("composio_trigger_list", ctx);
      const result = (await tool.execute({})) as { error: string };
      expect(result.error).toContain("timed out");
    });

    it("composio_trigger_delete times out on slow SDK call", async () => {
      mockTriggerDelete.mockReturnValue(new Promise(() => {}));
      const tool = findTool("composio_trigger_delete", ctx);
      const result = (await tool.execute({ triggerId: "tr-1" })) as { error: string };
      expect(result.error).toContain("timed out");
    });
  });

  // ── composio_trigger_create ─────────────────────────────────────────

  describe("composio_trigger_create", () => {
    it("creates a trigger and returns ID", async () => {
      mockTriggerCreate.mockResolvedValue({ id: "tr-abc123" });

      const tool = findTool("composio_trigger_create", { apiKey: "test-key" });
      const result = (await tool.execute({ slug: "LINEAR_ISSUE_CREATED" })) as {
        slug: string;
        triggerId: string;
        message: string;
      };

      expect(result.slug).toBe("LINEAR_ISSUE_CREATED");
      expect(result.triggerId).toBe("tr-abc123");
      expect(result.message).toContain("created");
    });

    it("rejects empty slug", async () => {
      const tool = findTool("composio_trigger_create", { apiKey: "test-key" });
      const result = (await tool.execute({ slug: "" })) as { error: string };
      expect(result.error).toContain("cannot be empty");
    });

    it("handles SDK errors gracefully", async () => {
      mockTriggerCreate.mockRejectedValue(new Error("Trigger limit reached"));

      const tool = findTool("composio_trigger_create", { apiKey: "test-key" });
      const result = (await tool.execute({ slug: "BAD_TRIGGER" })) as { error: string };
      expect(result.error).toContain("Failed to create trigger");
      expect(result.error).toContain("Trigger limit reached");
    });
  });

  // ── composio_trigger_list ───────────────────────────────────────────

  describe("composio_trigger_list", () => {
    it("returns formatted trigger list", async () => {
      mockTriggerListActive.mockResolvedValue({
        triggers: [
          { id: "tr-1", slug: "LINEAR_ISSUE_CREATED", status: "ACTIVE" },
          { id: "tr-2", slug: "GITHUB_COMMIT_EVENT", status: "ACTIVE" },
        ],
      });

      const tool = findTool("composio_trigger_list", { apiKey: "test-key" });
      const result = (await tool.execute({})) as {
        triggerCount: number;
        triggers: Array<{ id: string; slug: string }>;
      };

      expect(result.triggerCount).toBe(2);
      expect(result.triggers[0].slug).toBe("LINEAR_ISSUE_CREATED");
      expect(result.triggers[1].slug).toBe("GITHUB_COMMIT_EVENT");
    });

    it("returns empty list", async () => {
      mockTriggerListActive.mockResolvedValue({ triggers: [] });

      const tool = findTool("composio_trigger_list", { apiKey: "test-key" });
      const result = (await tool.execute({})) as { triggerCount: number };
      expect(result.triggerCount).toBe(0);
    });

    it("handles SDK errors gracefully", async () => {
      mockTriggerListActive.mockRejectedValue(new Error("Service unavailable"));

      const tool = findTool("composio_trigger_list", { apiKey: "test-key" });
      const result = (await tool.execute({})) as { error: string };
      expect(result.error).toContain("Failed to list triggers");
    });
  });

  // ── composio_trigger_delete ─────────────────────────────────────────

  describe("composio_trigger_delete", () => {
    it("deletes a trigger", async () => {
      mockTriggerDelete.mockResolvedValue(undefined);

      const tool = findTool("composio_trigger_delete", { apiKey: "test-key" });
      const result = (await tool.execute({ triggerId: "tr-abc" })) as {
        triggerId: string;
        message: string;
      };

      expect(result.triggerId).toBe("tr-abc");
      expect(result.message).toContain("deleted");
    });

    it("rejects empty triggerId", async () => {
      const tool = findTool("composio_trigger_delete", { apiKey: "test-key" });
      const result = (await tool.execute({ triggerId: "" })) as { error: string };
      expect(result.error).toContain("cannot be empty");
    });

    it("handles SDK errors gracefully", async () => {
      mockTriggerDelete.mockRejectedValue(new Error("Trigger not found"));

      const tool = findTool("composio_trigger_delete", { apiKey: "test-key" });
      const result = (await tool.execute({ triggerId: "tr-bad" })) as { error: string };
      expect(result.error).toContain("Failed to delete trigger");
      expect(result.error).toContain("Trigger not found");
    });
  });
});
