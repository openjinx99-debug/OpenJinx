# /setup — OpenJinx First-Time Setup Wizard

You are guiding the user through the first-time setup of OpenJinx, a local-first AI assistant. Walk through each step conversationally — ask one thing at a time, explain what each piece is for, and default to maximum security lockdown.

All credentials stay local in `~/.jinx/.env` — never committed to the repo.

## Setup State + Idempotent Reruns (Phase 1)

Before Step 1, always load or initialize setup state at `~/.jinx/setup-state.json`.

Primary helper commands:

- Initialize/normalize: `pnpm dev -- setup-state init`
- Show current state: `pnpm dev -- setup-state show --json`
- Mark step state: `pnpm dev -- setup-state set-step <step> <status>`
- Set assistant name: `pnpm dev -- setup-state set-name "<name>"`
- Set/clear block reason: `pnpm dev -- setup-state set-block "<reason>"` / `pnpm dev -- setup-state clear-block`

Use this schema:

```json
{
  "version": 1,
  "updatedAt": "ISO-8601 timestamp",
  "assistantName": "Jinx",
  "blockedReason": null,
  "steps": {
    "prerequisites": "pending",
    "dependencies": "pending",
    "assistantName": "pending",
    "apiKeys": "pending",
    "bootstrap": "pending",
    "whatsapp": "pending",
    "telegram": "pending",
    "sandbox": "pending",
    "verify": "pending"
  }
}
```

Valid step states: `pending | completed | skipped | blocked`.

Initialization and load rules:

1. Ensure `~/.jinx` exists (`mkdir -p ~/.jinx`).
2. If `~/.jinx/setup-state.json` does not exist, create it with the schema above.
3. Read state at the start of every `/setup` run and summarize what's already completed.
4. If a step is `completed`, default behavior is **skip** (idempotent rerun).
5. Only rerun a completed step if the user explicitly asks to rerun/refresh it.

State update rules:

- After each successful step, set that step to `completed`, update `updatedAt`, clear `blockedReason` if applicable.
- If the user chooses to skip optional channels (WhatsApp/Telegram), set that step to `skipped`.
- If a required prerequisite fails and cannot be resolved now, set that step to `blocked`, set `blockedReason`, and stop setup.
- At the end, write the final state back to `~/.jinx/setup-state.json`.

## Step 1: Prerequisites

Check that the user's environment is ready:

1. Verify **Node.js >= 22.12.0**: run `node --version` and parse the major version. If below 22, stop and tell the user to install Node 22+ (recommend `fnm` or `nvm`).
2. Verify **pnpm** is installed: run `pnpm --version`. If not found, tell the user to install it (`npm install -g pnpm` or `corepack enable`).

If Step 1 succeeds, set `steps.prerequisites = "completed"`.
If it fails and user cannot fix now, set `steps.prerequisites = "blocked"` with reason and stop.

Implementation commands:

- Success: `pnpm dev -- setup-state set-step prerequisites completed`
- Blocked: `pnpm dev -- setup-state set-step prerequisites blocked --reason "<why blocked>"`

## Step 2: Install Dependencies

Run `pnpm install` to install all project dependencies. Wait for it to complete. If it fails, show the error and help troubleshoot.

If Step 2 succeeds, set `steps.dependencies = "completed"`.
If install fails and user cannot fix now, set `steps.dependencies = "blocked"` with reason and stop.

Implementation commands:

- Success: `pnpm dev -- setup-state set-step dependencies completed`
- Blocked: `pnpm dev -- setup-state set-step dependencies blocked --reason "<why blocked>"`

## Step 3: Name the Assistant

Ask the user: **"What would you like to name your assistant?"** (default: **Jinx**)

Store this name — it will be used in:

- The agent config (`agents.list[0].name`)
- The workspace identity file (`IDENTITY.md`)
- The WhatsApp browser name (how the bot appears in WhatsApp's linked devices list)

When collected, write the value into setup state `assistantName` and set `steps.assistantName = "completed"`.

Implementation commands:

- `pnpm dev -- setup-state set-name "<assistant name>"`
- `pnpm dev -- setup-state set-step assistantName completed`

## Step 4: API Keys

Collect API keys one at a time. For each key, explain what it does and ask the user to paste it. Write all keys to `~/.jinx/.env`.

**Important**: Before writing each key, read the current `~/.jinx/.env` file (if it exists) so you don't overwrite existing keys. Append or update only the relevant line.

### 4a: Anthropic API Key (Claude)

First check if auth already works — run this to test:

```bash
# Check if OAuth token or API key is already available
node -e "
const { execSync } = require('child_process');
try {
  const raw = execSync('security find-generic-password -s \"Claude Code-credentials\" -w 2>/dev/null', { encoding: 'utf-8' }).trim();
  if (raw) { console.log('KEYCHAIN_OK'); process.exit(0); }
} catch {}
if (process.env.ANTHROPIC_API_KEY) { console.log('APIKEY_OK'); process.exit(0); }
if (process.env.CLAUDE_CODE_OAUTH_TOKEN) { console.log('OAUTH_OK'); process.exit(0); }
console.log('NO_AUTH');
"
```

- If `KEYCHAIN_OK` or `OAUTH_OK`: tell the user "Claude auth is already configured via Claude Code — no API key needed."
- If `APIKEY_OK`: tell the user "Anthropic API key already set."
- If `NO_AUTH`: explain that an Anthropic API key is **required** for Jinx to call Claude. Ask them to get one from https://console.anthropic.com/settings/keys and paste it. Write `ANTHROPIC_API_KEY=<key>` to `~/.jinx/.env`.
- If `NO_AUTH` and the user cannot provide a key now: this is a **hard blocker**.
  - Set `steps.apiKeys = "blocked"`.
  - Set `blockedReason = "Claude auth missing (no Keychain/OAuth/API key)"`.
  - Stop setup immediately (do not continue to Step 5+).
  - Tell the user to rerun `/setup` after either `claude login` (macOS) or adding `ANTHROPIC_API_KEY`.
  - Commands:
    - `pnpm dev -- setup-state set-step apiKeys blocked --reason "Claude auth missing (no Keychain/OAuth/API key)"`

### 4b: OpenAI API Key (Memory Embeddings)

Explain: "Jinx uses OpenAI's `text-embedding-3-small` model to create vector embeddings for memory search. Without this, memory search falls back to BM25 text matching only (still works, just less accurate for semantic queries)."

Ask: "Do you have an OpenAI API key? (Get one at https://platform.openai.com/api-keys)" — if yes, collect it and write `OPENAI_API_KEY=<key>` to `~/.jinx/.env`. If no, say "No problem — memory will use BM25 text search. You can add this later with `/customize`."

### 4c: OpenRouter API Key (Web Search)

Explain: "Jinx uses OpenRouter to access Perplexity Sonar for web search capabilities. This lets the assistant search the web for real-time information during conversations."

Ask: "Do you have an OpenRouter API key? (Get one at https://openrouter.ai/keys)" — if yes, collect it and write `OPENROUTER_API_KEY=<key>` to `~/.jinx/.env`. If no, say "No problem — web search will be unavailable. You can add this later with `/customize`."

### 4d: Composio API Key (External Integrations)

Explain: "Composio connects Jinx to external services like GitHub, Slack, and Gmail. This is optional and most users skip it initially."

Ask: "Do you have a Composio API key? (Get one at https://app.composio.dev)" — if yes, collect it and write `COMPOSIO_API_KEY=<key>` to `~/.jinx/.env`. If no, say "No problem — external integrations will be disabled. You can add this later with `/customize`."

After Step 4 completes with required Claude auth available, set `steps.apiKeys = "completed"` and clear any previous auth-related block reason.

Implementation command:

- `pnpm dev -- setup-state set-step apiKeys completed --clear-reason`

## Step 5: Bootstrap

Run the onboard command to create the Jinx home directory structure:

```bash
pnpm dev -- onboard
```

Then update the config with the chosen assistant name:

1. Read `~/.jinx/config.yaml`
2. Update `agents.list[0].name` to the chosen name
3. Write the updated config back

Also update the workspace identity file:

1. Read `~/.jinx/workspace/IDENTITY.md`
2. Replace occurrences of "Jinx" with the chosen assistant name (if the user chose a different name)
3. Write the updated file back

Set `steps.bootstrap = "completed"` when done.

Implementation command:

- `pnpm dev -- setup-state set-step bootstrap completed`

## Step 6: WhatsApp Setup (Security-Locked)

Ask: **"Would you like to set up WhatsApp?"** If no, skip to Step 7.

If no, set `steps.whatsapp = "skipped"`.

Implementation command:

- `pnpm dev -- setup-state set-step whatsapp skipped`

If yes:

1. Ask for the user's WhatsApp phone number in international format (e.g., `+44xxxxxxxxxx`). Explain: "This locks the bot so only YOUR phone number can interact with it."

2. Update `~/.jinx/config.yaml` to set:

```yaml
channels:
  whatsapp:
    enabled: true
    dmPolicy: allowlist
    allowFrom:
      - "+44xxxxxxxxxx" # user's phone number
    groupPolicy: disabled
    browserName: "<assistant name>"
```

3. Tell the user: "WhatsApp is configured and locked to your phone number. When you start the gateway (`pnpm dev -- gateway`), a QR code will appear in the terminal. Scan it with your phone: WhatsApp > Settings > Linked Devices > Link a Device."

Set `steps.whatsapp = "completed"` when done.

Implementation command:

- `pnpm dev -- setup-state set-step whatsapp completed`

## Step 7: Telegram Setup (Security-Locked)

Ask: **"Would you like to set up Telegram?"** If no, skip to Step 8.

If no, set `steps.telegram = "skipped"`.

Implementation command:

- `pnpm dev -- setup-state set-step telegram skipped`

If yes, walk through these steps:

1. **Create a bot with BotFather:**
   - Tell the user to open Telegram and message `@BotFather`
   - Send `/newbot`
   - Choose a display name (suggest using the assistant name)
   - Choose a username (must end in `bot`, e.g., `JinxAssistantBot`)
   - BotFather will reply with a token — ask the user to paste it

2. **Get the user's Telegram user ID:**
   - Tell the user to message `@userinfobot` on Telegram
   - It will reply with their user ID (a number like `123456789`)
   - Ask the user to paste their user ID

3. Update `~/.jinx/config.yaml` to set:

```yaml
channels:
  telegram:
    enabled: true
    botToken: "<token>"
    dmPolicy: allowlist
    allowedChatIds:
      - 123456789 # user's Telegram ID
    groupPolicy: disabled
    streaming: true
    mode: polling
```

4. Tell the user: "Telegram is configured and locked to your user ID. The bot will only respond to messages from you."

Set `steps.telegram = "completed"` when done.

Implementation command:

- `pnpm dev -- setup-state set-step telegram completed`

## Step 8: Sandbox Check (macOS 26+ Only)

Only if `process.platform === "darwin"`:

Run `container list 2>&1` to check if Apple Container runtime is available.

- If the command succeeds (exit code 0): tell the user "Apple Container sandbox is available — code execution will run in isolated containers."
- If the command fails: tell the user "Apple Container sandbox is not available on this macOS version. Code execution will be disabled, but everything else works fine. This requires macOS 26 (Tahoe) or later."

On non-macOS platforms, skip this step entirely.

Set `steps.sandbox = "completed"` when checked, or `skipped` on non-macOS.

Implementation commands:

- macOS checked: `pnpm dev -- setup-state set-step sandbox completed`
- non-macOS skipped: `pnpm dev -- setup-state set-step sandbox skipped`

## Step 9: Verify

Run the doctor command to validate everything:

```bash
pnpm dev -- doctor --onboarding
```

Review the output with the user:

- If all checks pass: "You're all set! Start the gateway with `pnpm dev -- gateway`, or chat locally with `pnpm dev -- chat`."
- Set `steps.verify = "completed"` and `blockedReason = null`.
- If any checks fail: help the user fix the failing checks before proceeding.
- If unresolved failures remain, set `steps.verify = "blocked"`, persist a clear `blockedReason`, and stop.

Implementation commands:

- Success: `pnpm dev -- setup-state set-step verify completed --clear-reason`
- Unresolved failure: `pnpm dev -- setup-state set-step verify blocked --reason "<doctor failure summary>"`

## Important Rules

- **One question at a time** — never dump a wall of config options
- **Security by default** — always use `dmPolicy: allowlist` and `groupPolicy: disabled`
- **Credentials stay local** — everything goes in `~/.jinx/.env`, never in the repo
- **Be helpful** — explain what each API key does and why it's needed
- **Respect skips** — if the user says "skip" or "no" for optional items, move on immediately
- **Preserve existing config** — when updating `~/.jinx/config.yaml`, read it first and merge changes, don't overwrite the whole file
- **Idempotent reruns by default** — completed steps are skipped unless the user explicitly requests rerun
- **Required blockers stop the flow** — do not continue setup when required Claude auth is missing
- **State must be durable** — always write `~/.jinx/setup-state.json` after any state change
