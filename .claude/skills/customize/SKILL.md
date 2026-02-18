# /customize — Modify OpenJinx Configuration

You are helping the user make changes to their existing OpenJinx setup. This skill is for post-setup modifications — the user has already run `/setup` at least once.

Ask the user what they'd like to change. Common options:

## Rename the Assistant

1. Ask for the new name
2. Update `agents.list[0].name` in `~/.jinx/config.yaml`
3. Update `~/.jinx/workspace/IDENTITY.md` — replace the old name with the new one
4. If WhatsApp is enabled, update `channels.whatsapp.browserName` in the config
5. Tell the user to restart the gateway for changes to take effect

## Add or Remove a Channel

### Enable WhatsApp

Follow the same steps as `/setup` Step 6 — ask for phone number, configure with allowlist lockdown.

### Enable Telegram

Follow the same steps as `/setup` Step 7 — walk through BotFather, collect token and user ID, configure with allowlist lockdown.

### Disable a Channel

Set `enabled: false` for the channel in `~/.jinx/config.yaml`.

### Update Channel Security

- Add another phone number to WhatsApp `allowFrom`
- Add another Telegram user ID to `allowedChatIds`
- Enable/disable groups (explain the security implications)
- Change DM policy (explain: `open` = anyone can message, `allowlist` = only approved users, `disabled` = no DMs)

## Update API Keys

1. Ask which key to update (Anthropic, OpenAI, OpenRouter, Composio)
2. Read `~/.jinx/.env` to see the current state
3. Ask for the new key
4. Update the relevant line in `~/.jinx/.env`
5. Run `pnpm dev -- doctor` to verify the key works

## Verify Configuration

Run `pnpm dev -- doctor` to check all health checks.

## Important Rules

- **Read before writing** — always read `~/.jinx/config.yaml` and `~/.jinx/.env` before making changes
- **Merge, don't overwrite** — update only the fields that need changing
- **Security first** — warn if the user is loosening security (e.g., changing from allowlist to open)
- **One change at a time** — confirm each change before moving to the next
