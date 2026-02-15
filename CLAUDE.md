# CLAUDE.md

This file provides guidance to Claude Code when working with the OpenJinx codebase.

## Project Overview

OpenJinx is a local-first, multi-channel AI assistant powered by the Claude Agent SDK. The assistant's name is **Jinx**. It connects to messaging platforms (Telegram, WhatsApp, terminal) through a WebSocket gateway, with autonomous heartbeat monitoring, cron scheduling, hybrid memory search, deep work async execution, and a skills framework.

Runtime data lives at `~/.jinx/` (config, sessions, memory, WhatsApp auth, workspace files).

## Essential Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Run via tsx (no build needed)
pnpm dev -- gateway       # Start WebSocket gateway
pnpm dev -- chat          # Interactive terminal chat
pnpm dev -- doctor        # System health check
pnpm dev -- onboard       # First-time setup wizard
pnpm build                # Production build (tsdown → dist/)
pnpm check                # Pre-commit: format check + type check + lint (REQUIRED before commits)
pnpm format               # Auto-format with oxfmt
pnpm lint                 # Lint with oxlint
pnpm lint:fix             # Auto-fix lint issues + reformat
```

## Testing

Three-tier test architecture with Vitest:

```bash
pnpm test                 # Unit tests (1242+ tests)
pnpm test:integration     # Integration tests (subsystem boundaries)
pnpm test:e2e             # System tests (end-to-end flows)
pnpm test:all             # All three tiers sequentially
pnpm test:coverage        # Unit tests with V8 coverage report
pnpm test:watch           # Watch mode
pnpm test:live            # Live API integration tests (needs credentials)
```

Run a single test file:

```bash
npx vitest run src/path/to/file.test.ts
```

Test files are colocated: `foo.ts` → `foo.test.ts`. Integration tests: `src/__integration__/`. System tests: `src/__system__/`. Shared helpers: `src/__test__/`.

Coverage thresholds enforced: 70% lines/functions/statements, 55% branches. Current: ~91% lines.

## Tech Stack & Conventions

- **Runtime**: Node >= 22.12.0
- **Language**: TypeScript, strict mode, ESM-only (`"type": "module"`)
- **Package manager**: pnpm
- **Build**: tsdown → `dist/`
- **Lint/format**: Oxlint + Oxfmt (not ESLint/Prettier)
- **Tests**: Vitest 4 with V8 coverage, forks pool
- **CLI framework**: Commander
- **Validation**: Zod
- **LLM**: Claude Agent SDK (`@anthropic-ai/sdk`)
- **Channels**: grammY (Telegram), Baileys (WhatsApp)

### Import Rules

- Use `import type { X }` for type-only imports
- Avoid `any` types (`typescript/no-explicit-any` is enforced)

### Code Style

- Keep files under ~700 LOC; extract helpers when larger
- Before creating any utility/helper, search for existing implementations first
- Always add tests for new functionality — no exceptions

## Architecture

### Source Layout (`src/`)

| Directory    | Purpose                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| `agents/`    | Agent runtime — system prompt, runner, tools, subagent registry           |
| `channels/`  | Channel adapters — `telegram/` (grammY), `whatsapp/` (Baileys)            |
| `cli/`       | CLI commands (chat, gateway, onboard, doctor, send, skills, etc.)         |
| `composio/`  | Composio integration — trigger subscriptions                              |
| `config/`    | Config loading (YAML/JSON5), Zod schema validation, defaults              |
| `cron/`      | Cron scheduler — jobs, timer, executor, backoff, store                    |
| `delivery/`  | Outbound message delivery — targeting, chunking                           |
| `events/`    | System event queue — formatting, consumption                              |
| `gateway/`   | WebSocket gateway — server, client, protocol, startup                     |
| `heartbeat/` | Autonomous heartbeat — runner, visibility, dedup, active hours, preflight |
| `infra/`     | Shared utilities — logging, env detection, home dir, time formatting      |
| `markdown/`  | Markdown processing — chunking, fence detection, IR, rendering            |
| `memory/`    | Memory system — daily logs, hybrid search, embeddings, index manager      |
| `pipeline/`  | Message pipeline — dispatch, lanes, streaming, classifier, deep work      |
| `providers/` | LLM provider — Claude SDK, auth (OAuth/API key/Keychain), models          |
| `sandbox/`   | Code execution — Apple Container manager, mount security                  |
| `sessions/`  | Session management — store, locks, transcripts, compaction, reaper        |
| `skills/`    | Skills framework — loader, parser, eligibility, dispatch, env overrides   |
| `tui/`       | Terminal UI — chat log, status bar, stream assembler                      |
| `types/`     | TypeScript type definitions                                               |
| `workspace/` | Workspace files — bootstrap, loader, filter, trim, templates              |

### Key Data Flow

1. **Inbound message** → Channel adapter (terminal/Telegram/WhatsApp) receives message
2. **Pipeline** (`pipeline/dispatch.ts`) resolves session, acquires lane lock (max 1 concurrent per session)
3. **Classifier** (`pipeline/classifier.ts`) routes quick vs deep work
4. **Agent runtime** (`agents/runner.ts`) loads workspace files, builds system prompt, calls Claude Agent SDK
5. **Tools** execute during the agent turn (memory, cron, exec, web search, etc.)
6. **Delivery** (`delivery/deliver.ts`) sends response back through the originating channel
7. **Heartbeat** (`heartbeat/runner.ts`) runs autonomously on a timer
8. **Cron** (`cron/service.ts`) fires scheduled jobs as isolated agent turns

### Key Architectural Patterns

- **Session lanes** (`pipeline/lanes.ts`): max 1 concurrent agent turn per session key
- **Streaming**: `emitStreamEvent`/`subscribeStream` pub-sub per session key (`pipeline/streaming.ts`)
- **Claude provider**: uses `stream: false` — full response per turn
- **Conversation history**: runner loads transcript via `readTranscript()`, passes as `history` to provider. MAX_HISTORY_TURNS=40
- **Config**: `~/.jinx/config.yaml`, Zod-validated, merged with defaults

### Intentional Stubs

Two features return `[]` by design (future work):

- **MCP Bridge** (`agents/tools/mcp-bridge.ts`) — placeholder for MCP tool forwarding
- **Channel cross-messaging tools** — placeholder for cross-channel message routing

## Lessons Learned

See `docs/lessons-learned.md` for detailed post-incident notes covering:

- WhatsApp multi-agent loop prevention
- Telegram streaming race conditions
- Test mock patterns and gotchas
- launchd service management pitfalls

## Skills

Skills live in `skills/<name>/SKILL.md` with flat YAML frontmatter. The loader (`src/skills/loader.ts`) scans directories and the parser (`src/skills/parser.ts`) reads key:value pairs. Supported fields: `name`, `display_name`, `description`, `required_bins`, `required_env`, `os`, `tags`.

The parser is a simple line-by-line splitter — not a full YAML parser. It only supports flat string fields.
