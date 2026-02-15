# Day Two To-Do List

> Created: 2026-02-13 — End of Day One
>
> Day One shipped: Terminal channel, Telegram channel (with streaming),
> memory system (BM25 + OpenAI vectors), skills loader, heartbeat system,
> gateway/WebSocket server, pipeline with session lanes, workspace bootstrap
> (with context-aware graduation), web search via Perplexity/OpenRouter,
> and 724 passing tests across 87 files.

---

## P0 — Wire the Last Mile

### 1. Cron Execution — Connect the Stub

The CronService infrastructure is complete (timer, persistence, backoff, job store) but
the `runTurn` callback in `startup.ts:166-169` is a placeholder that returns `"OK"`.
The cron _tool_ is also a stub (`cron-tools.ts`), so the agent can't create jobs either.

**What to do:**

- Wire `runTurn` to call `runAgent()` with a cron-specific session key
- Wire the cron tool to `CronService.add()` / `.remove()` / `.list()`
- Cron expression parsing is hardcoded to 1-minute — integrate `cron-parser` or similar
- Decide: should cron output go to terminal, Telegram, or both?

**Files:** `gateway/startup.ts`, `agents/tools/cron-tools.ts`, `cron/jobs.ts`

---

### 2. LLM Model Tiering — Wire the Light Tier

The runner only does a binary check — `"subagent"` or `"brain"`. The `"light"` tier
is never selected. Heartbeats run on Sonnet instead of Haiku.

**Target config:**

```yaml
llm:
  brain: opus # Opus 4.6 — conversations and chat
  subagent: sonnet # Sonnet 4.5 — coding tasks and subagent work
  light: haiku # Haiku 4.5 — heartbeats and lightweight ops
```

**What to do:**

- Add `"light"` as a valid tier selection in the runner (or pass tier directly instead of
  inferring from sessionType)
- Heartbeat turns in `startup.ts` should pass a tier/sessionType that resolves to `light`
- Update `~/.jinx/config.yaml` to `brain: opus`, `subagent: sonnet`, `light: haiku`
- Update `models.ts` MODEL_ID_MAP to use latest model strings if needed
- Consider: are there other lightweight operations (slug generation, summaries) that
  should also use the `light` tier?

**Files:** `agents/runner.ts:61-64`, `gateway/startup.ts:92-95`, `providers/models.ts`, `~/.jinx/config.yaml`

See also: Lesson #20 in `docs/lessons-learned.md`

---

### 3. Error Handling — Stop Silent Failures

**Global handlers (entry.ts):**

- Add `process.on('unhandledRejection')` and `process.on('uncaughtException')`
- Log the error, attempt graceful shutdown, exit with non-zero code

**Shutdown resilience (gateway.ts, startup.ts):**

- Add a 10-second timeout on `boot.stop()` — force-exit if services hang
- `await` the cron and heartbeat stop calls (currently fire-and-forget)

**Heartbeat loop protection (heartbeat/runner.ts):**

- Wrap `executeHeartbeat()` in try-catch so a single failure doesn't kill the tick loop
- `scheduleNext()` must always be called

**Network retries:**

- Web search (`web-search-tools.ts`) — add retry with backoff on 429/5xx
- Embedding API (`memory/embeddings.ts`) — same
- Consider extracting `fetchWithRetry` from `telegram/send.ts` into a shared `infra/` utility

**Silent catch blocks to fix:**

- `sessions/transcript.ts:45` — log when transcript read fails (agent loses history silently)
- `workspace/loader.ts:50` — distinguish "missing" from "permission denied"
- `channels/telegram/send.ts:128` — at least log typing indicator failures

**Send command timeout (cli/commands/send.ts):**

- Add a 30-second timeout — exit if no response from gateway

---

## P1 — Features That Matter

### 4. Dead Config Audit — Connect or Remove

These config fields are defined in the schema but never used. For each one, decide:
keep and wire, or delete.

| Field                               | Verdict Needed                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `logging.level` / `logging.file`    | Probably should wire to the logger — was this just forgotten?                            |
| `heartbeat.visibility.useIndicator` | Loaded but not consumed. What was it meant to do?                                        |
| `channels.telegram.groupPolicy`     | WhatsApp enforces this, Telegram doesn't. Wire it or remove.                             |
| `channels.whatsapp.phoneNumber`     | No code reads it. Remove unless WhatsApp session needs it.                               |
| `embeddingProvider`                 | Hardcoded `"openai"`. Fine for now — remove the config field or keep as future-proofing. |

### 5. Token-Aware Context Budgeting — Research First

Currently `MAX_HISTORY_TURNS = 40` is hardcoded in `runner.ts`. This means:

- Short messages waste context window (could fit more turns)
- Long messages with tool use might blow the window (40 turns could be huge)

OpenClaw has `src/agents/compaction.ts` which does token counting and auto-summarization.
Need to understand that approach and decide how much to port.

**Research tasks:**

- Read OpenClaw's compaction system and understand the token budgeting model
- Decide: simple token counting, or full compaction with summarization?
- Consider: does Claude's API return token counts we can use for budgeting?

### 6. Test Relevance Audit

724 tests pass, but:

- 68 source files have zero test coverage
- Some tests mock so heavily they can't catch real bugs
- No network failure scenarios tested

**What to do:**

- Prioritise tests for error paths (provider failures, API timeouts, rate limits)
- Add integration test for Telegram dispatch end-to-end
- Review heavily-mocked tests (startup.test.ts, bot.test.ts) — are they catching real bugs?
- Don't just add tests for coverage numbers — add tests that would have caught real issues

---

## P2 — Next Horizons

### 7. WhatsApp Channel

Full implementation exists but is not initialized in startup.ts. Also, three core
modules are stubs:

- `session.ts` — needs Baileys socket wiring
- `media.ts` — media download returns empty buffer
- `login-qr.ts` — QR code flow not implemented

This is a big piece of work. Probably its own dedicated session.

### 8. Transcript Day Boundaries

Transcripts are one file per session key, growing forever. The 40-turn history limit
prevents context blowup, but the files themselves never rotate. Options:

- Rotate transcripts daily (new file per day)
- Compact old transcripts into summaries
- Or just leave it — the 40-turn limit makes this low-impact

### 9. TUI Sessions Command

`/sessions` returns "not yet implemented". Low priority but would be nice for debugging.

### 10. MCP Bridge

`createMcpToolDefinitions()` returns empty array. Keep as stub — this is a future
enhancement for connecting to external MCP servers. Not needed for current use cases.

### 11. Channel Tools (Phase 4A)

`message`, `sessions_send`, `sessions_list` are stubs. These enable the agent to
cross-post between channels (e.g., Telegram message triggers a WhatsApp message).
Not needed until multi-channel is actually running.

---

## Architecture Diagram — Needed

Create `jinx/docs/architecture.md` with:

- Current system diagram (what's wired and working)
- Provider stack: Claude API (main), OpenAI (embeddings), OpenRouter/Perplexity (web search)
- Channel flow: Telegram → dispatch → agent → stream → send
- Memory flow: write → index → BM25 + vector search → RAG context
- Config + startup boot sequence
- What's stubbed vs. what's live

---

## Day One Wins (For the Record)

What we shipped and verified working:

- Terminal interactive chat via TUI + gateway WebSocket
- Telegram channel with long-polling, streaming (edit-message), and access control
- Claude provider with OAuth/API key/Keychain auth chain
- Memory system: BM25 keyword search + optional OpenAI vector embeddings
- Skills loader with eligibility checks and system prompt injection
- Heartbeat system with configurable intervals and active hours
- Pipeline with streaming pub-sub and session lane concurrency control
- Web search via Perplexity Sonar through OpenRouter
- Workspace bootstrap with context-aware graduation (fixed today!)
- Gateway WebSocket server with auth and rate limiting
- 87 test files, 724 tests, all green
