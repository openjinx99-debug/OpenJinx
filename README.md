# OpenJinx

Local-first, multi-channel AI assistant powered by the Claude Agent SDK.

Jinx connects to messaging platforms (Telegram, WhatsApp, terminal) through a WebSocket gateway, with autonomous heartbeat monitoring, cron scheduling, memory search, and a skills framework.

## Prerequisites

- **Node.js** >= 22.12.0
- **pnpm** >= 10.x
- **Claude Code** installed and logged in (recommended), OR an `ANTHROPIC_API_KEY`

## Install

```bash
pnpm install
pnpm dev onboard            # First-time setup (creates ~/.jinx/, config, workspace)
pnpm dev doctor             # Verify everything is green
```

## Authentication

Jinx resolves auth automatically using this priority chain:

| Priority | Source                            | How to set                            |
| -------- | --------------------------------- | ------------------------------------- |
| 1        | `CLAUDE_CODE_OAUTH_TOKEN` env var | `export CLAUDE_CODE_OAUTH_TOKEN=...`  |
| 2        | `ANTHROPIC_API_KEY` env var       | `export ANTHROPIC_API_KEY=sk-ant-...` |
| 3        | **macOS Keychain** (automatic)    | Just have Claude Code logged in       |

**There is no `.env` file.** Jinx does not read from or write to any `.env` file.

### Recommended: Reuse Claude Code's OAuth token (zero setup)

If you have [Claude Code](https://claude.ai/code) installed and logged in on your Mac, Jinx automatically reads the OAuth token from the macOS Keychain. No env vars, no config, no `.env` file needed.

Claude Code stores its credentials in the Keychain under:

- **Service:** `Claude Code-credentials`
- **Account:** your macOS username

Jinx reads this at runtime via the `security` CLI — nothing is copied or cached.

To verify: `pnpm dev doctor` will show `[OK] Claude auth` if the token is found.

### Alternative: API key

If you're not using Claude Code or you're on Linux/Windows:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Get a key from [console.anthropic.com](https://console.anthropic.com) > Settings > API Keys.

### Implementation details

The auth logic lives in `src/providers/auth.ts`. The Keychain lookup uses:

```bash
security find-generic-password -s "Claude Code-credentials" -w
```

This returns JSON: `{"claudeAiOauth": {"accessToken": "...", "refreshToken": "..."}}`. Jinx extracts the `accessToken` field. The Keychain fallback only runs on macOS (`process.platform === "darwin"`) and silently returns `undefined` on other platforms.

### Keychain permissions note

Claude Code creates its Keychain entry with `don't-require-password` and `/usr/bin/security` in the authorized applications list. This means any process that can run the `security` CLI can read the token without a macOS password prompt. This is how both Claude Code and Jinx access it seamlessly. If you want stricter access control, you can modify the Keychain entry via Keychain Access.app > right-click the entry > Get Info > Access Control.

## Development

Run directly from source via tsx (no build step required):

```bash
pnpm dev                    # Show help / available commands
pnpm dev chat               # Interactive terminal chat
pnpm dev gateway            # Start the WebSocket gateway server
pnpm dev onboard            # First-time setup wizard
pnpm dev doctor             # System health check
pnpm dev skills list        # List available skills
pnpm dev memory status      # Memory index status
pnpm dev send "hello"       # Send a one-shot message via gateway
pnpm dev config show        # View current configuration
```

## Production Build

```bash
pnpm build                  # Compiles to dist/ via tsdown
node dist/entry.js          # Run the CLI
node dist/entry.js chat     # Or any subcommand
```

After building, the `jinx` bin is available if you link the package:

```bash
pnpm link --global
jinx chat
```

## Standalone Install

Jinx can be installed as a standalone npm package:

```bash
# From a tarball
pnpm build && pnpm pack
npm install -g openjinx-0.1.0.tgz
jinx --help

# Or install from the built dist directly
npm install -g .
jinx doctor
```

The tarball includes the compiled dist, bundled skills, and README.

## Configuration

Jinx looks for config at `~/.jinx/config.yaml` (override with `JINX_CONFIG` env var).

The `onboard` command creates this for you. See `examples/config.yaml` for a fully documented example, or `examples/config.minimal.yaml` for a minimal setup. Minimal example:

```yaml
llm:
  authMode: oauth # "oauth" (default, uses Keychain) or "api_key"
  brain: sonnet # primary model (opus | sonnet | haiku)
  subagent: sonnet # sub-agent model
  light: haiku # lightweight tasks (heartbeat, cron)

channels:
  terminal:
    enabled: true
  telegram:
    enabled: false
    botToken: "your-bot-token"
  whatsapp:
    enabled: false

gateway:
  host: 127.0.0.1
  port: 18790
```

All fields have sensible defaults — an empty config file works out of the box with OAuth auth (reads from macOS Keychain) and terminal channel only. **You do not need a `.env` file.** See [Authentication](#authentication) above for how credentials are resolved.

### Key Config Sections

| Section     | Purpose                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `llm`       | Auth mode, model tiers (brain/subagent/light), budget limits, max turns |
| `agents`    | Named agent definitions with workspace paths                            |
| `channels`  | Channel adapters — terminal, telegram, whatsapp                         |
| `skills`    | Skill directories and exclusions                                        |
| `memory`    | Memory search — embedding provider, vector weight, max results          |
| `heartbeat` | Autonomous heartbeat — interval, visibility (showOk, showAlerts)        |
| `cron`      | Cron scheduler — max jobs, persistence path                             |
| `gateway`   | WebSocket gateway — host, port                                          |
| `logging`   | Log level (debug, info, warn, error)                                    |

## Testing

Jinx uses a three-tier test architecture with Vitest:

| Tier        | Command                 | Files   | Tests    | Purpose                           |
| ----------- | ----------------------- | ------- | -------- | --------------------------------- |
| Unit        | `pnpm test`             | 119     | 1242     | Individual module behavior        |
| Integration | `pnpm test:integration` | 2       | 11       | Subsystem boundary tests          |
| System      | `pnpm test:e2e`         | 8       | 37       | End-to-end multi-subsystem flows  |
| **All**     | `pnpm test:all`         | **129** | **1290** | Runs all three tiers sequentially |

### Additional test commands

```bash
pnpm test:coverage          # Unit tests with V8 coverage report
pnpm test:watch             # Watch mode (re-runs on file changes)
npx vitest run src/path/to/file.test.ts   # Run a single test file
```

### Coverage thresholds

Enforced on every `pnpm test:coverage` run:

| Metric     | Threshold | Current |
| ---------- | --------- | ------- |
| Lines      | 70%       | 91.68%  |
| Statements | 70%       | 90.92%  |
| Branches   | 55%       | 86.30%  |
| Functions  | 70%       | 88.21%  |

### Test file conventions

- Unit tests: colocated as `foo.test.ts` next to `foo.ts`
- Integration tests: `src/__integration__/*.integration.test.ts`
- System tests: `src/__system__/*.system.test.ts`
- Shared test helpers: `src/__test__/` (mock SDK, mock channel, factories)

## Code Quality

```bash
pnpm check                  # Runs all three: format check + type check + lint
pnpm format                 # Auto-format with oxfmt
pnpm lint                   # Lint with oxlint
pnpm lint:fix               # Auto-fix lint issues + reformat
```

Type checking alone:

```bash
npx tsc --noEmit
```

## Project Structure

```
openjinx/
├── src/
│   ├── entry.ts              # CLI entry point
│   ├── index.ts              # Library entry point
│   ├── cli/                  # CLI commands (chat, gateway, onboard, doctor, etc.)
│   ├── agents/               # Agent runtime — system prompt, tools, model resolution
│   ├── channels/             # Channel adapters
│   │   ├── telegram/         # Telegram (grammY) — bot, handlers, streaming, media
│   │   └── whatsapp/         # WhatsApp (Baileys) — session, QR login, media
│   ├── config/               # Config loading (YAML/JSON5), Zod validation, defaults
│   ├── cron/                 # Cron scheduler — jobs, timer, executor, backoff
│   ├── delivery/             # Outbound delivery — targeting, chunking, reasoning
│   ├── events/               # System event queue — formatting, consumption, filtering
│   ├── gateway/              # WebSocket gateway — server, client, protocol, startup
│   ├── heartbeat/            # Autonomous heartbeat — runner, visibility, dedup, active hours
│   ├── infra/                # Shared utilities — logging, env, home dir, time formatting
│   ├── memory/               # Memory system — chunker, hybrid search, daily logs, embeddings
│   ├── pipeline/             # Message pipeline — dispatch, lanes, streaming, classifier, deep work
│   ├── providers/            # LLM provider — Claude Agent SDK, auth, model mapping
│   ├── sessions/             # Session management — store, locks, transcripts, compaction
│   ├── skills/               # Skills framework — loader, parser, eligibility, dispatch
│   ├── types/                # TypeScript type definitions
│   ├── workspace/            # Workspace files — bootstrap, loader, filter, trim
│   ├── tui/                  # Terminal UI (future)
│   ├── __test__/             # Shared test infrastructure
│   ├── __integration__/      # Integration tests (6 files)
│   └── __system__/           # System tests (5 files)
├── skills/                   # Bundled skills (11)
│   ├── apple-notes/          # Apple Notes (macOS)
│   ├── apple-reminders/      # Apple Reminders (macOS)
│   ├── coding-agent/         # Codex/Claude Code/OpenCode/Pi orchestration
│   ├── github/               # GitHub integration
│   ├── session-logs/         # Session log search
│   ├── skill-creator/        # Skill creation wizard
│   ├── summarize/            # URL/YouTube/PDF summarization
│   ├── tmux/                 # tmux session control
│   ├── weather/              # Weather forecasts
│   ├── web-fetch/            # Web page fetching
│   └── web-search/           # Web search
├── dist/                     # Build output (tsdown)
├── package.json
├── tsconfig.json
├── tsdown.config.ts
├── vitest.config.ts          # Unit test config
├── vitest.integration.config.ts
└── vitest.system.config.ts
```

## Architecture Overview

```
Terminal / Telegram / WhatsApp
         │
         ▼
   ┌─────────────┐     ┌──────────┐
   │   Gateway    │◄────│   Cron   │
   │  (WebSocket) │     │ Scheduler│
   └──────┬──────┘     └────┬─────┘
          │                  │
          ▼                  ▼
   ┌─────────────┐     ┌──────────┐
   │  Pipeline    │     │Heartbeat │
   │  (dispatch,  │     │ Runner   │
   │   classify,  │     └────┬─────┘
   │   lanes)     │          │
   └──┬───────┬──┘          │
      │       │              │
   quick    deep             │
      │       │              │
      │       ▼              │
      │  ┌──────────┐       │
      │  │Deep Work │       │
      │  │(async bg)│       │
      │  └────┬─────┘       │
      │       │              │
      ▼       ▼              ▼
   ┌─────────────────────────────┐
   │        Agent Runtime        │
   │  (system prompt, tools,     │
   │   Claude Agent SDK)         │
   └──────┬──────────────┬──────┘
          │              │
          ▼              ▼
   ┌──────────┐   ┌──────────┐
   │  Memory   │   │  Skills  │
   │  Search   │   │ Framework│
   └──────────┘   └──────────┘
```

### Key Data Flow

1. **Inbound message** arrives via channel adapter (terminal, Telegram, WhatsApp)
2. **Pipeline** resolves session, acquires lane lock (max 1 concurrent per session)
3. **Agent runtime** loads workspace files, builds system prompt, calls Claude Agent SDK
4. **Tools** execute during the agent turn (memory search, cron management, etc.)
5. **Delivery** sends the response back through the originating channel
6. **Heartbeat** runs autonomously on a timer, checking in with the agent
7. **Cron** fires scheduled jobs as isolated agent turns

## Sandbox (Code Execution)

Jinx uses **Apple Container** (macOS 26+) for sandboxed code execution — not Docker. This is a deliberate design choice: Apple Container provides native macOS containerization with lower overhead, tighter OS integration, and no dependency on Docker Desktop or third-party container runtimes.

**Requirements:**

- macOS 26 (Tahoe) or later
- No Docker, Podman, or other container runtime needed

The sandbox is enabled by default in config. When the agent needs to run code, it launches an isolated Apple Container with a restricted `PATH` (`/usr/local/bin:/usr/bin:/bin`) and a 5-minute execution timeout. Containers are automatically cleaned up after 15 minutes of idle time.

If you're on an older macOS version or Linux, the sandbox will not be available. The agent will still function — it just won't have code execution capabilities.

## Skills

Skills are markdown files (`SKILL.md`) with YAML frontmatter that extend the agent's capabilities. They live in `~/.jinx/skills/` or the bundled `skills/` directory.

```bash
pnpm dev skills list        # See all available skills
```

### Bundled Skills (11)

| Skill               | Binary      | Description                                     |
| ------------------- | ----------- | ----------------------------------------------- |
| **github**          | `gh`        | GitHub repos, issues, PRs, CI runs              |
| **session-logs**    | `jq`        | Search and analyze past session logs            |
| **skill-creator**   | —           | Create new skills for Jinx                      |
| **web-fetch**       | `curl`      | Fetch and read content from URLs                |
| **web-search**      | `curl`      | Search the web via DuckDuckGo                   |
| **weather**         | `curl`      | Weather forecasts (no API key needed)           |
| **summarize**       | `summarize` | Summarize URLs, YouTube, PDFs                   |
| **coding-agent**    | `claude`    | Run Claude Code as a sub-agent for coding tasks |
| **tmux**            | `tmux`      | Remote-control interactive terminal sessions    |
| **apple-notes**     | `memo`      | Manage Apple Notes (macOS)                      |
| **apple-reminders** | `remindctl` | Manage Apple Reminders (macOS)                  |

To create a new skill, use the built-in skill creator or manually create `~/.jinx/skills/<name>/SKILL.md`.

### Skill Format

Jinx skills use a flat YAML frontmatter header inside a standard Markdown file:

```yaml
---
name: my-skill
display_name: My Skill
description: What this skill does
required_bins: some-cli
os: macos, linux
tags: tag1, tag2
---
# Instructions (Markdown)

The body is injected into the system prompt when the skill is active.
```

Supported frontmatter fields: `name`, `display_name`, `description`, `required_bins`, `required_env`, `os`, `tags`.

**Compatibility note:** Jinx's frontmatter format differs from Claude Code (which uses fields like `allowed-tools`, `context`, `agent`). The Markdown body is portable — only the frontmatter header needs adaptation. See the future work section below for Claude Code skill compatibility plans.

### Future Work: Claude Code Skill Compatibility

Claude Code skills use the same `SKILL.md` convention but with richer frontmatter (`allowed-tools`, `context: fork`, `agent`, `$ARGUMENTS` substitution, `!` backtick dynamic context injection). To support drop-in Claude Code skills, the parser would need:

1. Proper YAML parsing (boolean values, lists, nested objects)
2. `$ARGUMENTS` / `$0` substitution for parameterized skills
3. `!` backtick command execution for dynamic context injection
4. `allowed-tools` / `context` / `agent` fields for tool restrictions and subagent routing

Until then, Claude Code skill bodies work as-is in Jinx — the frontmatter just needs manual adaptation to the flat format above.

## Deep Work (Async Task Execution)

Jinx automatically detects complex requests — multi-step research, comparative analysis, tasks requiring web search and code execution — and routes them to a background deep work session. The user gets an immediate acknowledgment and can keep chatting; the result is delivered back to the originating channel when it's done, with any generated files sent as document attachments.

### How It Works

```
User sends message via WhatsApp/Telegram
        │
  dispatchInboundMessage()
        │
  [command or < 20 chars?] ──yes──> Normal dispatch (unchanged)
        │ no
  classifyTask() [Haiku, ~200ms]
        │
    quick ──> Normal dispatch (unchanged)
        │
      deep
        │
  1. Ack to user: "Working on this — I'll get back to you when it's done."
  2. Fire-and-forget launchDeepWork()
  3. Return immediately (user can keep chatting)
        │
  ── async, off the session lane ──
        │
  runAgent() with tier: "brain" (Opus), 15min timeout,
  full tools: container, web search, memory, cron
        │
  deliverOutboundPayloads() back to originating channel
  + any written files sent as document attachments
```

### Key Design Decisions

| Decision         | Choice                          | Why                                                        |
| ---------------- | ------------------------------- | ---------------------------------------------------------- |
| Classifier       | Haiku LLM call (~200ms)         | Heuristics are brittle; Haiku is cheap and fast            |
| Fallback         | Always "quick" on error         | Never block normal dispatch due to classifier failure      |
| Execution        | Fire-and-forget Promise         | Deep work must not block the user's session lane           |
| Model tier       | `tier: "brain"` (Opus)          | Deep work is real work, not a cheap task                   |
| Timeout          | 15 minutes                      | Enough for multi-step web research + code execution        |
| Delivery         | `deliverOutboundPayloads()`     | Reuses existing delivery infra with chunking + media       |
| File attachments | Extract from `write` tool calls | Files the agent writes are read back and sent as documents |
| Cleanup          | SessionReaper                   | Sweeps `deepwork:` sessions after 24h                      |

### Files

| File                         | Purpose                                       |
| ---------------------------- | --------------------------------------------- |
| `src/pipeline/classifier.ts` | LLM-based task classification (quick vs deep) |
| `src/pipeline/deep-work.ts`  | Async deep work executor + file extraction    |
| `src/pipeline/dispatch.ts`   | Classification gate (modified)                |
| `src/gateway/startup.ts`     | SessionReaper prefix (modified)               |

## Composio (External Integrations)

Jinx integrates with [Composio](https://composio.dev) to provide 800+ external service integrations — GitHub, Slack, Gmail, Linear, Notion, and more — without writing custom adapters.

### How It Works

The agent uses Composio tools to discover, authenticate, and execute external service actions:

1. **Search** — `composio_search` finds the right tool slug (e.g. `LINEAR_CREATE_LINEAR_ISSUE`)
2. **Check connection** — `composio_check_connection` verifies the service is authenticated
3. **Connect** — `composio_connect` generates an OAuth URL for the user to visit
4. **Execute** — `composio_execute` calls the external service with the tool slug

All SDK calls are wrapped with configurable timeouts (default 60s) to prevent hangs.

### Trigger Subscriptions (Real-Time Events)

Services can push events _back_ to Jinx via Composio's Pusher-based trigger system. The agent manages triggers with three additional tools:

- `composio_trigger_create` — Subscribe to events (e.g. `LINEAR_ISSUE_CREATED`, `GITHUB_COMMIT_EVENT`)
- `composio_trigger_list` — List active trigger subscriptions
- `composio_trigger_delete` — Remove a trigger

Triggers use an outbound WebSocket (Pusher) — no public URL, tunnel, or port forwarding needed. Events arrive via the heartbeat system and are processed by the agent on the next heartbeat cycle.

### Setup

1. Enable in `~/.jinx/config.yaml`:
   ```yaml
   composio:
     enabled: true
     timeoutSeconds: 60 # per-call timeout (default)
   ```
2. Add your API key to `~/.jinx/.env`:
   ```
   COMPOSIO_API_KEY=your-key-here
   ```
3. Authenticate services via chat: ask the agent to connect to GitHub/Linear/etc. and visit the OAuth URL it provides.

### CLI Commands

```bash
pnpm dev composio auth          # Authenticate with Composio
pnpm dev composio connections   # List active connections
```

### Tools Reference

| Tool                        | Purpose                         |
| --------------------------- | ------------------------------- |
| `composio_search`           | Find tools by name/description  |
| `composio_execute`          | Execute a tool by slug          |
| `composio_connections`      | List authenticated connections  |
| `composio_connect`          | Generate OAuth URL              |
| `composio_check_connection` | Check if a service is connected |
| `composio_trigger_create`   | Subscribe to real-time events   |
| `composio_trigger_list`     | List active triggers            |
| `composio_trigger_delete`   | Remove a trigger                |

## Workspace Files

The workspace (`~/.jinx/workspace/`) contains 8 markdown files that shape the agent's personality and behavior:

| File           | Purpose                                     |
| -------------- | ------------------------------------------- |
| `SOUL.md`      | Core personality and values                 |
| `AGENTS.md`    | Agent definitions and roles                 |
| `IDENTITY.md`  | Name, voice, style                          |
| `USER.md`      | User preferences and context                |
| `TOOLS.md`     | Available tools and usage guidelines        |
| `HEARTBEAT.md` | Heartbeat instructions and monitoring rules |
| `BOOTSTRAP.md` | First-run bootstrap instructions            |
| `MEMORY.md`    | Memory system instructions                  |

Run `jinx onboard` to create these with starter templates.

## License

MIT
