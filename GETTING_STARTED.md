# Getting Started with OpenJinx

## Choose a Setup Path

You have two valid setup paths:

1. **Guided setup (`/setup`)** in Claude Code: opinionated, interactive, recommended.
2. **Manual bootstrap (`jinx onboard`)**: creates scaffolding, then you configure keys/channels yourself.

Both paths end with `jinx doctor`, and `jinx doctor --onboarding` for blocker-focused readiness output.

## Prerequisites

- **Node.js 22.12.0+** — install via [fnm](https://github.com/Schniz/fnm) or [nvm](https://github.com/nvm-sh/nvm)
- **pnpm** — `npm install -g pnpm` or `corepack enable`
- **Claude Code CLI** — optional but recommended for guided `/setup` ([claude.ai/claude-code](https://claude.ai/claude-code))

## API Key Checklist (Prepare Before Setup)

- **Claude runtime (required)**: either
  - Claude Code login (`claude login`) for macOS Keychain OAuth, or
  - Anthropic API key (`ANTHROPIC_API_KEY`) from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- **OpenAI (optional)** for vector memory: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **OpenRouter (optional)** for web search: [openrouter.ai/keys](https://openrouter.ai/keys)
- **Composio (optional)** for external integrations: [app.composio.dev](https://app.composio.dev)

Keys are stored locally in `~/.jinx/.env`. Jinx auto-loads this file at startup.

## Path A: Guided Setup in Claude Code (Recommended)

```bash
# 1. Clone and enter the repo
git clone https://github.com/your-org/OpenJinx.git
cd OpenJinx

# 2. Install dependencies
pnpm install

# 3. Launch Claude Code and run setup
claude
/setup
```

What `/setup` configures:

| Step               | What it does                                                 |
| ------------------ | ------------------------------------------------------------ |
| Home bootstrap     | Runs `jinx onboard` to create `~/.jinx` config + workspace   |
| Assistant name     | Names your assistant (default: Jinx)                         |
| Anthropic API key  | Required fallback for Claude auth                            |
| OpenAI API key     | Optional — enables vector memory search                      |
| OpenRouter API key | Optional — enables web search via Perplexity                 |
| Composio API key   | Optional — enables GitHub/Slack/Gmail integrations           |
| WhatsApp           | Optional — connects via QR code, locked to your phone        |
| Telegram           | Optional — creates bot via BotFather, locked to your user ID |
| Sandbox            | Checks Apple Container availability (macOS 26+)              |
| Verification       | Runs `jinx doctor --onboarding` and reports readiness        |

Channels default to secure posture (`dmPolicy: allowlist`, `groupPolicy: disabled`) when configured through the guided flow.
Guided setup persists progress in `~/.jinx/setup-state.json` and skips completed steps by default on rerun.
Use `pnpm dev -- setup-state show --json` to inspect current setup progress state.

## Path B: Manual Bootstrap + Configuration

```bash
# 1. Install dependencies
pnpm install

# 2. Bootstrap ~/.jinx structure (config + workspace templates)
pnpm dev -- onboard

# 3. Copy and fill in API keys
cp .env.example ~/.jinx/.env

# 4. Enable and configure channels as needed
# Edit ~/.jinx/config.yaml

# 5. Verify setup
pnpm dev -- doctor
pnpm dev -- doctor --onboarding
```

`onboard` is intentionally non-interactive. It creates both `~/.jinx/workspace/` (identity files) and `~/.jinx/tasks/` (task output root), plus a valid config baseline. It points you to `/setup` if you want guided channel/key configuration.

## Run Commands

```bash
pnpm dev -- gateway    # Start the gateway (WhatsApp + Telegram)
pnpm dev -- chat       # Interactive terminal chat
pnpm dev -- doctor     # System health check
pnpm dev -- doctor --onboarding   # Onboarding blockers + remediation hints
```

## Post-Setup Changes

Run `/customize` in Claude Code to modify your setup after initial configuration: rename the assistant, add channels, or rotate/update API keys.
