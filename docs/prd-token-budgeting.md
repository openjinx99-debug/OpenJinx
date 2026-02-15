# Token-Aware Context Budgeting — Research

## Current State (Jinx)

Jinx uses a fixed `MAX_HISTORY_TURNS = 40` limit in `src/agents/runner.ts:161`. Each "turn" is one user or assistant message. 40 turns ~ 20 exchanges, which fits in Sonnet's 200K context alongside system prompt, workspace files, and tool definitions.

**Problems with fixed limits:**

- No awareness of actual token consumption — a single tool-heavy turn can blow the budget
- No degradation path when context fills up — just hard truncation at 40 turns
- No compaction/summarization — old context is lost entirely

## OpenClaw Approach

OpenClaw has a sophisticated multi-stage compaction system in `src/agents/compaction.ts`:

### Token Estimation

- `estimateMessagesTokens()` calculates total tokens across all messages
- Uses a `SAFETY_MARGIN = 1.2` (20% buffer) for estimation inaccuracy

### Context Budget

- `maxHistoryShare` controls what fraction of context is reserved for history (default 0.5)
- Context window resolved from: user config > model metadata > 200K default
- Hard minimum: 16K tokens (`CONTEXT_WINDOW_HARD_MIN_TOKENS`)

### Compaction Pipeline

When new content exceeds `contextWindow * maxHistoryShare * SAFETY_MARGIN`:

1. **Prune** — `pruneHistoryForContextShare()` drops oldest message chunks
2. **Chunk** — `splitMessagesByTokenShare()` divides into N parts by token distribution
3. **Summarize** — `summarizeInStages()` summarizes each chunk, then merges summaries
4. **Repair** — `repairToolUseResultPairing()` fixes tool call/result pairing in transcript
5. **Append metadata** — Tool failures + file operations added to summary

### Key Constants

- `BASE_CHUNK_RATIO = 0.4` — default chunk = 40% of context
- `MIN_CHUNK_RATIO = 0.15` — minimum chunk = 15%
- Adaptive ratio computed based on message size distribution

### Compaction Safeguard Hook

- Triggered by Pi agent before compacting session history
- Session-scoped settings via WeakMap registry
- For split turns: generates separate summaries for prefix vs. history
- Robust fallback: if summarization fails, truncates with warning

## Proposed Jinx Approach

### Phase 1: Token Counting (Low Effort)

- Add approximate token counting: `chars / 4` as initial heuristic
- Track total estimated tokens in transcript metadata
- Log warnings when approaching 80% of context window

### Phase 2: Sliding Window with Summary (Medium Effort)

- When transcript exceeds token budget:
  1. Take oldest N turns that push us over budget
  2. Summarize them into a `{ role: "system", isCompaction: true }` turn (already supported by `loadHistory`)
  3. Replace dropped turns with the summary in the transcript file
- Use `tier: "light"` (Haiku) for summarization to keep costs low

### Phase 3: Full Compaction (High Effort)

- Port OpenClaw's chunking + multi-stage summarization
- Add tool call/result repair (Jinx doesn't have this problem yet since we use full responses, not streaming)
- Context-aware chunk sizing (adaptive ratio)

## Key Differences from OpenClaw

| Aspect              | OpenClaw                          | Jinx                                         |
| ------------------- | --------------------------------- | -------------------------------------------- |
| Agent framework     | Pi agent (streaming)              | Direct Claude API (full response)            |
| Token counting      | Precise via model metadata        | Approximate (chars/4)                        |
| History format      | AgentMessage (complex)            | TranscriptTurn (simple JSONL)                |
| Compaction trigger  | Pi agent hook                     | Would be in `loadHistory()`                  |
| Tool repair         | Essential (streaming can corrupt) | Not needed (full responses are always valid) |
| Summarization model | Same as agent model               | Haiku (light tier) for cost savings          |

## Recommendation

Start with Phase 1 (token counting + logging). It's zero-risk and provides visibility. Phase 2 should follow when we see truncation warnings in production — the existing `isCompaction` support in `loadHistory` means the transcript format is already ready for it.
