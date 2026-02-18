# Lessons Learned: Jinx Tool Wiring Gap

Captured 2026-02-13 during the Jinx agent runtime build.

## 1. Stub-First Development Hides Gaps

**What happened:** All six core tools (read, write, edit, exec, glob, grep) and both memory tools were implemented as stubs returning `{ note: "Handled by SDK" }`. The type system saw valid `AgentToolDefinition` objects — identical signatures to real implementations. No compiler or linter could distinguish stub from real.

**Lesson:** When using stub-first development, mark stubs with a searchable sentinel. Before declaring a feature complete, `grep -r "Handled by SDK\|not yet initialized\|stub\|TODO"` across the relevant modules.

## 2. "Handled by SDK" Is a Misleading Comment

**What happened:** The comment "Delegated to Claude Agent SDK built-in tool" implied the SDK would magically execute file I/O. It doesn't — the SDK calls the `execute` function we provide. The comment masked a fundamental misunderstanding of the integration contract.

**Lesson:** Comments that claim delegation to an external system should be verified with an actual integration test that checks the side effect (e.g., file exists on disk after `write` tool call).

## 3. Testing Plumbing vs. Behavior

**What happened:** Existing tests verified that tool definitions had the right shape (name, schema, execute function exists). They never verified that calling `execute` actually read or wrote a file. The tests were green, giving false confidence.

**Lesson:** Integration tests must verify **observable side effects**, not just function signatures. For file tools: assert file content on disk. For search tools: assert match results against known data.

## 4. Defining "Done" as Observable Behavior

**What happened:** The tool implementation was considered "done" because the code existed and compiled. But Jinx couldn't actually modify USER.md or MEMORY.md — the core use case.

**Lesson:** Define "done" as: _"A user can ask Jinx to update USER.md, and the file changes on disk."_ Not: _"The write tool definition exists in core-tools.ts."_

## 5. Checklist Before Calling a Feature Complete

- [ ] Search for stub markers: `"Handled by SDK"`, `"not yet initialized"`, `"stub"`, `"TODO"`
- [ ] Run an end-to-end flow that exercises the feature's primary use case
- [ ] Verify side effects (files on disk, messages sent, state changed)
- [ ] Check that the dispatch/runner actually passes the tools to the execution engine

## 6. Working with LLMs on Implementation

When reviewing LLM-generated code, ask:

- _"What can't it do yet?"_ — not just _"What did you build?"_
- _"Show me the execute function body"_ — not just the tool definition shape
- _"What happens when I call this tool at runtime?"_ — trace the full call path
- _"Is there a test that verifies the file was actually written?"_

## 7. The "Visible Content, Invisible Path" Anti-Pattern

**What happened:** Workspace files were injected into the system prompt as `<workspace-file name="USER.md">` — the agent saw the content but had no idea where the file lived on disk (`/Users/tommy/.jinx/workspace/USER.md`). Tools required absolute paths. The agent guessed `/workspace/USER.md`, `/tmp/workspace/USER.md`, `/root/workspace/USER.md` — all wrong. Every write attempt failed silently.

**Lesson:** When an LLM agent has tools that operate on the filesystem, the system prompt must include the absolute paths to every directory the agent can access. Content injection without path context is read-only by design — the agent can see data but never modify it.

## 8. path.resolve() Does Not Expand Tilde

**What happened:** `assertAllowed` used `path.resolve(filePath)` to normalize paths before checking the sandbox. But `path.resolve("~/.jinx/workspace/USER.md")` produces `$CWD/~/.jinx/workspace/USER.md` — the literal character `~` is treated as a directory name, not the home directory. The sandbox check always failed for tilde paths.

**Lesson:** In Node.js, `~` expansion is a shell feature, not a `path` module feature. Any code that accepts user/agent-provided paths and compares against an allowlist must call `expandTilde()` (or equivalent) BEFORE `path.resolve()`.

## 9. Trace the Full Round-Trip, Not Just One Direction

**What happened:** The workspace loader correctly read files from `~/.jinx/workspace/` and injected them into the prompt. Tests verified files appeared in the prompt. But nobody tested the return path: can the agent, given only the information in the prompt, use its tools to write back to those files? The read path worked; the write path was broken at three independent points.

**Lesson:** For any agent capability that involves reading AND writing, test the full round-trip: data enters the prompt → agent decides to modify → tool call succeeds → file changes on disk. Testing only the read direction gives false confidence that the write direction works.

## 10. PRDs Are Not Self-Executing

**What happened:** A 30K-character PRD (`prd-memory-system.md`) specified everything: nine workspace files with exact lifecycle semantics, a bootstrap ritual where the agent self-deletes BOOTSTRAP.md, session summaries written on `/new`, heartbeat-driven memory maintenance, pre-compaction flushes. The PRD was detailed, correct, and completely ignored by the implementation.

The implementation built the _scaffolding_ — file loaders, session hooks, a heartbeat runner, a flush function — but stopped at the interface boundary. Every outward-facing contract was satisfied (types compile, tests pass, functions exist) while every inward behavior was hollow:

- `flushMemoryBeforeCompaction()` logged a message and returned
- `/new` returned the string `"New session started."` and did nothing
- `onSessionEnd()` was fully implemented but never called by anything
- Templates contained generic boilerplate instead of the specific instructions the PRD prescribed
- The heartbeat prompt said "Read HEARTBEAT.md" but never mentioned memory maintenance
- BOOTSTRAP.md was a 20-line checklist instead of a birth ritual with self-deletion

The PRD sat in `docs/` while the code was built from type signatures outward. Nobody closed the loop.

**Why it happened:** LLM-assisted implementation gravitates toward _structural completeness_ — making the type checker happy, getting tests green, wiring up the module graph. This feels like progress because every file compiles and every test passes. But the PRD specifies _behavioral outcomes_ (the agent introduces itself, files appear on disk, memory gets curated), and those require someone to read the PRD line by line and verify each behavior is wired end-to-end.

The gap is predictable: PRDs describe what the system _does_; code describes what the system _is_. When an LLM builds from types outward, it produces the "is" without the "does."

**Lesson:** After generating an implementation from a PRD:

1. **Walk the PRD's user stories, not the code's module graph.** For each behavior the PRD describes ("agent deletes BOOTSTRAP.md after bootstrap"), trace the call chain from trigger to side effect. If the chain has a gap (no caller, stub body, missing prompt instruction), it's not done.

2. **Templates are code.** The text inside SOUL.md and AGENTS.md is as important as the TypeScript that loads them — it's the prompt that makes the LLM do the right thing. Generic template content produces generic behavior. The PRD's specific language ("Be genuinely helpful, not performatively helpful") needs to land in the actual template files, not just the PRD.

3. **Stubs satisfy types but break pipelines.** A function with the right signature and an empty body is invisible to the compiler and to tests that only check types. The flush stub, the `/new` stub, the placeholder heartbeat prompt — all type-correct, all behaviorally dead. Search for `// stub`, `// placeholder`, `// TODO`, and functions that log-and-return before declaring a pipeline complete.

4. **Test the pipeline, not the parts.** Every piece worked in isolation: templates loaded, the heartbeat runner ran, `onSessionEnd` wrote files, transcripts recorded turns. But the pipeline — conversation → `/new` → session summary → daily log → heartbeat → MEMORY.md curation — was never tested as a connected flow. Integration tests that exercise the full pipeline from trigger to artifact would have caught every gap.

## 11. Hooks That Are Never Called

**What happened:** `onSessionEnd()` in `memory/session-hook.ts` was a fully working function — correct filesystem operations, proper slug generation, daily log integration. It had been implemented, reviewed, and tested in isolation. But nothing in the system ever called it.

The `/new` command was handled in the TUI layer (`tui/commands.ts`) as a simple string return: `async () => "New session started."`. It never reached the dispatch pipeline where sessions live. The gateway, Telegram, and every other channel had no way to trigger it either. A fully implemented function with zero callers is dead code that looks alive.

**Lesson:** For every hook or callback function, verify there is at least one call site that exercises it in a real execution path (not just a unit test). `grep` for the function name across the codebase — if it only appears in its own file and its test file, it's not wired. The acid test: can you describe the runtime event that causes this function to execute? If the answer is "nothing yet" or "it'll be wired later," it's a stub with extra steps.

## 12. The Heartbeat Is the Agent's Autonomy — Not Health-Check Plumbing

**What it is:** The heartbeat is the single mechanism that transforms a reactive chatbot into a 24/7 autonomous agent. Without it, the agent is dead between conversations — it can only respond when spoken to. With it, the agent has continuous background consciousness: it wakes up on its own, looks around, thinks, acts, and decides whether to speak or stay silent.

**What it is NOT:** Despite the name, the heartbeat is not a health check. It's not "is the process alive?" pinging. It's not monitoring infrastructure. The name borrows from biology — a heartbeat is what keeps a living organism functioning between external stimuli. The agent's heartbeat keeps it _alive_ between conversations.

**What the heartbeat actually does on each tick:**

- **Checks its task list** (HEARTBEAT.md) — a self-maintained checklist the agent can update
- **Processes queued async results** — background commands that finished, cron job outputs, external triggers
- **Maintains its own memory** — curating, distilling, organizing memory files without being asked
- **Monitors the outside world** — email, calendar, notifications, weather, whatever it's been asked to track
- **Makes judgment calls** — "This email looks urgent, I should alert the user" vs. "Nothing new, stay quiet"
- **Proactively reaches out** — check-ins after long idle periods, reminders about upcoming events
- **Manages its own workspace** — updating files, committing changes, organizing notes

**The critical design decision:** Each heartbeat tick is a **full agent turn** — same model, same tools, same workspace files, same session context as a normal conversation. The agent can read files, write files, run commands, search memory, schedule cron jobs, send messages across channels. It's not a degraded callback or a limited polling loop. It's a complete cognitive cycle.

This is what makes the agent genuinely proactive rather than merely responsive. A user can go to sleep, and the agent continues working — checking email overnight, processing the results of long-running tasks, updating memory, and having a summary ready in the morning. The agent doesn't wait for permission to think; it thinks on its own schedule and speaks only when it has something worth saying.

**The silence protocol makes this sustainable:** `HEARTBEAT_OK` suppression means the agent runs 48 times a day (at 30-minute intervals) but the user only hears from it when something genuinely needs attention. Silence is the default. Alerts break through. This is what makes always-on autonomy tolerable rather than annoying — the agent is always watching but only speaks when it matters.

**Why this lesson matters for the implementation:** Every piece of plumbing we build — memory search, embeddings, event queues, cron scheduling, channel adapters — exists to serve the heartbeat loop. The heartbeat is the consumer of all these capabilities. If the memory system works but the heartbeat can't search it, the agent can't maintain its own knowledge. If the cron system works but can't wake the heartbeat, scheduled tasks have no way to reach the agent. The heartbeat is the central nervous system; everything else is an organ it uses.

## 13. Sophisticated Components That the Consumer Bypasses

**What happened:** `MemorySearchManager` had a complete hybrid search pipeline — file discovery, chunking, BM25 scoring, cosine similarity, configurable vector weighting. But the agent's `memory_search` tool (the function the LLM actually calls at runtime) did its own simple `readdir` + `string.includes()` grep loop. The search manager existed, was tested, and worked — but the agent never used it.

This is subtly different from #11 (hooks never called). The search manager _was_ called — by its own unit tests. But the actual consumer at runtime — the tool the LLM invokes — had no reference to it. The entire hybrid search pipeline was dead weight from the agent's perspective.

**Why it happened:** The tool and the search manager were built in separate phases. The tool was implemented first with a quick grep fallback ("we'll wire the real search later"). The search manager was built later with full hybrid scoring. But nobody went back to the tool to replace the grep with a `searchManager.search()` call. Each piece had its own tests, both were green, and the gap between them was invisible.

**Lesson:** When building a pipeline with multiple layers (tool → manager → index → search), verify the wiring end-to-end from the outermost consumer inward. Ask: _"When the agent calls `memory_search`, what code actually executes the search?"_ If the answer is "a grep loop in the tool" instead of "the hybrid search manager," you have a bypass. The presence of a sophisticated component doesn't mean it's being used.

## 14. Stubs That Return Valid-Looking Data Are Harder to Catch

**What happened:** The embedding provider stub returned `texts.map(() => new Array(1536).fill(0))` — a 1536-dimensional zero vector for every input. This was dimensionally correct, type-safe, and produced valid (but meaningless) search scores. The hybrid search formula `vectorWeight * 0 + (1 - vectorWeight) * textScore` silently collapsed to pure BM25. Everything appeared to work.

Compare this with a stub that throws `new Error("Not implemented")` or returns `undefined` — those fail immediately and loudly. A zero vector fails _silently_ because it's technically valid data that produces technically valid (but useless) results.

**Lesson:** Stubs that return structurally valid but semantically empty data (zero vectors, empty strings, `{ ok: true }`) are the hardest to detect because they satisfy every check except "does this actually do the right thing?" When writing stubs:

1. **Prefer stubs that throw** over stubs that return plausible-looking data. `throw new Error("Embedding provider not wired")` would have been caught immediately.
2. **If a stub must return data** (to avoid breaking callers), mark it with a detectable pattern. For example, return `[-1, -1, -1, ...]` instead of `[0, 0, 0, ...]` — an impossible embedding that would produce visibly wrong similarity scores.
3. **Add a smoke test that validates semantic correctness**, not just structural correctness. For embeddings: "the vector for 'cat' and 'kitten' should be more similar than 'cat' and 'refrigerator'." A zero-vector stub would fail this immediately.

## 15. Graceful Degradation Must Be Explicit at Every Layer

**What happened (done right):** When wiring real embeddings into the search pipeline, every layer was designed to degrade gracefully if embeddings aren't available:

- **Boot time**: No `OPENAI_API_KEY`? Create `MemorySearchManager` without an `EmbeddingProvider`. Log which mode is active.
- **Search manager constructor**: `EmbeddingProvider` is optional. No provider → no query embeddings → hybrid search falls back to pure BM25.
- **Chunk indexing**: Embedding API fails? Log a warning, store chunks without vectors. Search still works via BM25.
- **Query time**: Embedding API fails? Log a warning, pass `undefined` as query embedding. BM25 takes over.

The result: users without an OpenAI key get the exact same behavior as before (BM25 keyword search). Users with a key get hybrid search. API outages degrade to BM25 mid-session without crashing.

**Lesson:** When adding an optional enhancement layer (embeddings, caching, analytics), design degradation explicitly at every boundary where the enhancement is consumed. Don't just make the parameter optional — handle the absent case with logging so operators can tell which mode they're running in. The pattern: `if (provider) { try { use it } catch { warn and fallback } } else { fallback }` at each layer independently.

## 16. Dependency Injection Requires Plumbing Through Every Layer

**What happened:** `MemorySearchManager` was created in `startup.ts` with full OpenAI embedding support — hybrid BM25 + vector search, 30-second auto-sync, the works. It was passed to the heartbeat runner, which used it correctly. But the regular chat dispatch pipeline — the path that handles every actual user message via gateway and Telegram — never received it.

`DispatchDeps` had two fields: `{ config, sessions }`. No `searchManager`. So when `dispatchInboundMessage()` called `runAgent()`, it passed no search manager. `assembleDefaultTools()` received `undefined` for the searchManager parameter. The memory_search tool fell back to a basic grep loop. The entire embedding pipeline — embedding provider, hybrid search, vector scoring — sat idle during every real conversation.

The heartbeat used it. Tests passed. The infrastructure was real and working. But the primary consumer — the chat pipeline that handles 99% of interactions — was never connected.

**Why it happened:** The heartbeat was the first feature to use searchManager, and it was wired directly in `startup.ts` as an inline callback. When the dispatch pipeline was built separately, nobody threaded searchManager through the `DispatchDeps` interface → `createGatewayServer()` → `dispatchInboundMessage()` → `runAgent()` chain. The dep injection worked at one call site but was never plumbed to the others.

**Lesson:** When a dependency is created at boot time and consumed by multiple subsystems, verify it reaches _every_ consumer, not just the first one wired. The checklist:

1. Search for every call site of the function that consumes the dependency (e.g., `runAgent` with `searchManager`)
2. For each call site, trace back to boot: does the dependency flow through every interface and constructor in the chain?
3. If the dependency is optional (like `searchManager?: MemorySearchManager`), grep for call sites that omit it — those are the gaps

The type system won't help here because the parameter is optional. `runAgent({ prompt, config, ... })` compiles fine without `searchManager` — it just silently degrades.

## 17. The "Works in One Path" Illusion

**What happened:** The embedding-powered memory search worked perfectly — in heartbeat turns. The heartbeat prompt said "use memory_search," the heartbeat runner passed searchManager, and the agent correctly searched and curated memory. Meanwhile, regular chat (the thing the user actually interacts with) used grep fallback. From the developer's perspective, "memory search works" was true. From the user's perspective, "the bot doesn't know anything about me" was also true.

**Lesson:** When a feature has multiple execution paths (heartbeat vs. chat, gateway vs. Telegram, CLI vs. API), verify the feature works in _each path independently_. One green path can mask N broken ones. The fix is simple: for every capability, list all the paths that should have it, and test each one.

## 18. AI-Assisted Development Has a Testing Blind Spot

**What happened:** Across Jinx's development, the same pattern repeated: infrastructure was built, unit tests passed, types compiled, and the feature was declared done. But the actual end-to-end behavior was broken. The only way these gaps were discovered was manual testing by a human who said "wait, why isn't it doing the thing?"

This isn't a Jinx-specific problem — it's a pattern in AI-assisted development more broadly. LLMs are excellent at:

- Building structurally correct code that compiles
- Writing unit tests that verify the shape of things
- Satisfying type constraints and interface contracts
- Producing modules that work in isolation

LLMs are poor at:

- Verifying that modules are _connected_ to each other in production paths
- Testing emergent behavior that requires the full system running
- Noticing that an optional parameter being omitted means a feature silently degrades
- Asking "but does the user actually experience this working?"

The result is a consistent gap between "the code exists and passes tests" and "the feature works when a human uses it." Every lesson in this document (#1 through #17) is a variation of this same theme.

**Why it happens:** LLMs optimize for the signals available during development — compiler output, test results, type errors. These are all _structural_ signals. The _behavioral_ signal — "does the user see the right thing?" — requires running the system end-to-end and observing the output, which is harder to automate and easier to skip.

**What to do about it:**

1. **End-to-end smoke tests are non-negotiable.** After any feature is "done," run the system and exercise the feature from the user's perspective. Not a unit test — the actual system with actual I/O. For Jinx: send a message via Telegram, verify the bot responds using its tools and memory.

2. **Trace the dependency graph at review time.** Before declaring a feature complete, pick the key dependency (searchManager, embedding provider, etc.) and trace it from creation to every consumer. If it doesn't reach a consumer, it's not wired.

3. **Make degradation loud, not silent.** When an optional capability is missing, log a WARNING, not a debug message. `searchManager` being undefined in the chat path should have screamed, not whispered. Consider: if the system works "fine" without it, how would anyone know it's missing?

4. **"It works in tests" is necessary but not sufficient.** Adopt the mindset that tests prove the code is _possible_, not that it's _wired_. The question isn't "can this function work?" but "does this function get called in the paths that matter?"

5. **Human-in-the-loop testing isn't a failure — it's a requirement.** Until AI can reliably test emergent system behavior, manual smoke testing after integration is the safety net. Budget time for it. Don't treat "the tests pass" as permission to ship.

## 19. Memory Must Reach the Conversation — Not Just Exist

**What happened:** The memory system had storage (workspace files, daily logs), indexing (BM25 + vector search), and search tools (`memory_search`, `memory_get`). All worked correctly in isolation. But nothing ensured memory actually reached the agent during a conversation. Three independent gaps:

1. **`searchManager` not threaded to all execution paths** (#16) — the chat pipeline never received it, so RAG pre-search was silently skipped.
2. **No automatic RAG pre-search** — even when `searchManager` was available, there was no code to search memory before the LLM call. The agent had to decide on its own to call `memory_search`, which it often didn't.
3. **No proactive tool directives** — the system prompt mentioned memory tools existed but never told the agent to use them before answering questions about prior context. The agent treated memory search as optional rather than mandatory.

The result: a fully functional memory system that the agent rarely consulted. Users stored preferences and facts, then asked about them in later sessions, and the agent had no idea.

**What fixed it (belt-and-suspenders):**

- **RAG pre-search** (`buildRagContext` in `runner.ts`): Runs automatically on every `runAgent()` call. Takes the user's prompt, searches memory, appends `# Relevant Memory` to the system prompt. The agent sees relevant context before generating its first token — zero effort required from the LLM.
- **Memory Recall directive** (system prompt section): Explicit instruction — "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run `memory_search`..." Only appears for main sessions with memory tools in the tool list.
- **Tool description language**: `memory_search` description starts with "Mandatory recall step:" — reinforces that this isn't optional.
- **Startup wiring validation**: Logs which execution paths have `searchManager` connected, so missing wiring is visible immediately at boot.
- **E2E smoke test**: `memory-utilization.system.test.ts` verifies the full pipeline: write fact → index → search → RAG context → system prompt.

**Lesson:** A memory system has three layers — storage, retrieval, and _utilization_. It's natural to focus on the first two (can we store it? can we find it?) and forget the third (does it reach the LLM?). Utilization requires:

1. **Automatic context injection** — don't rely on the agent choosing to search. Pre-fetch relevant memory and inject it into the system prompt on every turn.
2. **Redundant directives** — RAG pre-search catches the common case; explicit tool directives catch what automatic retrieval misses. Neither alone is sufficient.
3. **Wiring validation at boot** — log which paths have the memory pipeline connected. If a new channel is added without threading `searchManager`, it should be visible immediately.
4. **E2E tests that cross the storage/retrieval/utilization boundary** — unit tests for search and unit tests for prompt building don't catch the gap between them. Test the full flow: data in → search finds it → LLM sees it.

## 20. Abstractions Built But Never Selected — The Model Tiering Gap

**What happened:** The PRD specified three model tiers: Opus for conversations (smart, knowledgeable), Sonnet for everyday coding/subagent tasks, and Haiku for cheap lightweight operations like heartbeats. The implementation built the full abstraction:

- `ClaudeModelTier` type: `"brain" | "subagent" | "light"` (config types)
- `TIER_DEFAULTS` map: `brain → sonnet`, `subagent → sonnet`, `light → haiku` (models.ts)
- `resolveModelForTier()`: resolves tier → model ID with config overrides (models.ts)
- `resolveModel()`: per-agent override for brain tier (scope.ts)
- Config fields: `llm.brain`, `llm.subagent`, `llm.light` all present in config.yaml

Everything compiles. Config loads. The resolver works. But the runner's model selection at `runner.ts:63` is:

```typescript
sessionType === "subagent" ? "subagent" : "brain";
```

That's a binary check. `"light"` is never selected by any code path. Heartbeats call `runAgent()` with `sessionType: "main"`, which maps to `"brain"` — so heartbeats run on Sonnet (the conversation model) instead of Haiku (the cheap model). Every 15 minutes, a full Sonnet turn fires for a heartbeat that 90% of the time returns `HEARTBEAT_OK`.

The `light` tier exists in types, config, defaults, and resolver — five layers of abstraction — but zero layers of selection. No code ever asks for it.

**Why it happened:** Same pattern as lessons #1, #11, and #16. The abstraction was built outward from types, satisfying the compiler at each layer. But the consumer (the runner) was written with a simple binary check because at the time, "main or subagent" covered the two existing use cases. When heartbeats were wired later, they used `sessionType: "main"` because that's what worked — nobody circled back to ask "should this use a different tier?"

The config even has `light: haiku` set correctly. The user did their part. The code just never reads it for that purpose.

**Lesson:** When building a tiered or stratified system (model tiers, pricing tiers, permission levels), verify that every tier has at least one code path that selects it. The checklist:

1. For each tier/level defined in the type system, `grep` for code that actually selects that value
2. If a tier is only referenced in type definitions, config schemas, and defaults — but never in a conditional branch or function call — it's dead
3. Pay special attention to the "cheapest" or "lowest" tier — it's the easiest to forget because the system works fine without it (just more expensively)
4. Config values that are loaded but never influence a branch are silent waste — the user thinks they're controlling behavior, but the code ignores them

## 21. Existing Green Tests Create an Illusion of Coverage for New Wiring

**What happened:** Message envelopes and session_status were implemented across six files. Each new piece had its own unit tests: `formatZonedTimestamp()` (5 tests), `formatMessageEnvelope()` (13 tests), `session_status` tool (5 tests), system prompt update (2 assertions). All green. Full suite: 873 tests passing.

But the **wiring points** — where the new code connects to existing code — had zero test coverage:

- `dispatch.ts` now wraps prompts with envelopes before calling `runAgent()` → **not tested.** The existing dispatch test mocked `runAgent` and verified `searchManager` passthrough, but never checked what `prompt` contained.
- `dispatch.ts` now passes `sessions` to `runAgent()` → **not tested.** The existing test's `expect.objectContaining({ searchManager })` didn't fail because extra fields don't violate `objectContaining`.
- `dispatch.ts` captures `previousActiveAt` and skips elapsed on first message → **not tested.** No test exercised the timing logic.
- `runner.ts` → `assembleDefaultTools()` now includes `session_status` when `sessions` is provided → **not tested.** Existing runner tests passed `tools: []`, bypassing tool assembly entirely.
- `aggregateTools()` signature changed to accept session tools → **not tested.** No test for `mcp-bridge.ts` existed at all.

The existing test files for `dispatch.test.ts` and `runner.test.ts` were green and present — creating the _feeling_ that dispatch and runner were tested. But they only tested the behavior that existed when those tests were written. The new integration points were invisible to them.

**Why it's different from previous lessons:** Lesson #11 (hooks never called) is about functions with zero callers. Lesson #18 (AI testing blind spot) is the general pattern. This is a specific, insidious variant: **when you modify an existing function that already has tests, the existing tests provide false confidence that the modification is also covered.** The test file exists. It passes. It even tests the same function. It just doesn't test the new behavior you added to it.

This is particularly dangerous with AI-assisted development because:

1. The AI writes focused unit tests for the new code (envelope, session tools) — which pass
2. The AI runs the existing test suite — which passes
3. "All tests pass" becomes the signal that everything works
4. Nobody asks "do the existing tests for dispatch cover the new envelope wrapping?"

**What caught it:** A human asking "are you sure the tests are valid and run e2e?" — prompting a manual review of what the existing tests actually assert vs. what the new code actually does.

**Lesson:** When modifying an existing function, don't just verify the existing tests still pass — **verify the existing tests cover the new behavior.** Specifically:

1. **Read the test file for every function you modified** — not just "did it pass?" but "does it assert the thing I changed?"
2. **For each new code path added to an existing function**, check: is there a test that would fail if I reverted just this change? If no test would break, the change is untested.
3. **`expect.objectContaining()` is a false friend** — it validates what's present but ignores what's missing. A test that checks `objectContaining({ searchManager })` will pass even if `sessions`, `prompt`, and every other field is wrong.
4. **Existing test files are not living documentation of current behavior** — they're snapshots of what was tested at the time they were written. When code grows, tests must grow with it.

## 22. Lane-Aware Heartbeat Suppression — Inject Callbacks, Don't Import Directly

**What happened:** The heartbeat runner needed to check if a user conversation was active on the session lane before firing. The naive approach would be to import `getSessionLane` directly into `runner.ts`, but this creates a hard coupling between the heartbeat module and the lane module.

**What we did instead:** Added an optional `isLaneBusy?: (agentId: string) => boolean` callback to the `HeartbeatRunner` constructor. The gateway's `startup.ts` wires the callback: `(agentId) => { const lane = getSessionLane(...); return lane.running > 0 || lane.pending > 0; }`. The heartbeat module has zero knowledge of lanes.

**Lesson:** When a module needs to check state from another subsystem, prefer injecting a callback over importing the dependency. This keeps modules testable (mock the callback) and decoupled (heartbeat doesn't know about lanes). The wiring happens at boot time in one place.

## 23. Multi-Channel Delivery with Terminal Fallback

**What happened:** Heartbeat delivery was hardcoded to `terminal:dm:local`. Telegram and WhatsApp users never got heartbeat messages.

**What we built:** A `deliverHeartbeatEvent()` function that resolves the target channel from the session store (which channel did the user last interact from?), checks channel readiness, delivers via the universal `deliverOutboundPayloads()` pipeline, and falls back to terminal if the channel isn't ready or delivery fails.

**Lesson:** When adding multi-target delivery, always have a fallback. The terminal is the guaranteed-available channel — if Telegram is down, the message still reaches somewhere. The resolution order (session → channel → ready check → deliver → fallback) gives maximum flexibility without over-engineering.

## 24. Persistent + In-Memory Dual Store for Duplicate Detection

**What happened:** Heartbeat duplicate detection was in-memory only. On restart, the agent would re-send the same "Weather is sunny" message it sent 5 minutes ago.

**What we built:** A `DuplicateStore` interface with `getLast`/`setLast`. The persistent adapter is backed by `SessionEntry.lastHeartbeatText`/`lastHeartbeatSentAt` fields (which already existed but were unused). In-memory is the primary cache; persistent is only consulted when in-memory is empty (restart scenario).

**Lesson:** When you have a cache that loses state on restart, check if the persistence layer already has fields for it. `SessionEntry` had `lastHeartbeatText` and `lastHeartbeatSentAt` sitting unused — the fix was wiring them, not adding new storage. The dual-store pattern (in-memory primary, persistent fallback) avoids the performance cost of hitting disk on every check while still surviving restarts.

## 25. Wake Retry with Backoff and Max Retry Cap

**What happened:** `requestHeartbeatNow` could fire when the session lane was busy, and the wake would be silently lost.

**What we built:** Changed `HeartbeatWakeCallback` to return a `WakeResult` type (`{ status: "ok" }` or `{ status: "skipped", reason: "lane-busy" }`). On skip or error, the wake retries after 1 second. Max 5 retries to prevent infinite loops.

**Lesson:** Any fire-and-forget mechanism that can be blocked by transient state needs a retry path. Without it, events are silently dropped. The max retry cap is critical — without it, a persistently busy lane would cause an infinite retry loop. 5 retries over 5 seconds is enough for a conversation turn to complete.

## 26. Use `croner` Over Hand-Rolled Cron Parsing

**What happened:** The hand-rolled cron parser supported `*`, `N`, and `*/N` — nothing else. No ranges (`9-17`), no lists (`9,12,18`), no day-of-week (`1-5`). Users couldn't express "weekdays at 9am."

**What we did:** Replaced the ~50 lines of `parseField()` + scanning loop with 10 lines using `croner` (same version already in the root package). Full cron syntax, timezone support, battle-tested.

**Lesson:** Don't hand-roll parsers for well-specified formats. The hand-rolled version felt simple but had an ever-growing list of "limitations" that users would hit. A library that's already in your dependency tree costs nothing and covers every edge case. The function signature didn't even change — same inputs, same outputs, just correct behavior.

## 27. Session Reaper for Ephemeral Sessions

**What happened:** Cron isolated sessions (`cron:{agentId}:{timestamp}`) were created on every cron job execution and never cleaned up. Over weeks, thousands of dead sessions and transcript files accumulated.

**What we built:** `SessionReaper` — a periodic sweep (default 1h) that finds sessions matching configurable prefixes where `lastActiveAt` is older than a TTL (default 24h). Deletes the transcript file and removes the session from the store.

**Lesson:** Any code path that creates ephemeral sessions needs a corresponding cleanup mechanism. The reaper pattern — periodic sweep with prefix matching and age-based TTL — is generic enough to handle any ephemeral session type. Start it at boot, stop it at shutdown, and ephemeral sessions take care of themselves.

## 28. Runtime Detection Must Verify the Service, Not Just the Binary

**What happened:** The Apple Container sandbox had comprehensive unit tests, integration tests, type safety, and correct plumbing through every execution path (gateway → dispatch → runner → tools). The Zod config schema even defaulted `sandbox.enabled: true`. Everything compiled, all tests passed, the wiring was correct.

But when a real user sent a WhatsApp message that should have triggered container execution, nothing happened. The `container` CLI binary existed at `/usr/local/bin/container` (v0.9.0), and the runtime detection function `isAppleContainerReady()` checked `container --version` — which succeeded. So the container manager was created at startup. But the actual container system service had never been started (`container system start`). Every real `container run` or `container list` call would fail with an XPC connection error.

The runtime detection tested the _presence_ of the tool, not the _readiness_ of the service it depends on.

**This is lesson #3 and #18 all over again — yet another instance of tests verifying structure (binary exists, types compile, code paths are wired) while missing the runtime prerequisite (the daemon must be running).** The pattern is persistent: build infrastructure, write tests that prove the infrastructure works in isolation, declare it done, never verify the full runtime stack is operational.

**What we fixed:**

1. Changed `isAppleContainerReady()` to run `container list` instead of `container --version`. `container list` requires the system service — it fails immediately with a descriptive error if the service isn't started.

2. Added a startup warning in `startup.ts`: when `sandbox.enabled` is true but `isAppleContainerReady()` returns false, log a WARN with the exact command to fix it (`container system start`). The agent exec tool is disabled with a clear message rather than silently failing later.

3. Updated `describeRuntime(false)` to mention `container system start` — so the error message tells the user exactly what to do.

**Lesson:** When a feature depends on an external service or daemon, the readiness check must verify the _service is operational_, not just that the _client binary exists_. A CLI tool can be installed without its backing service running. A library can be imported without its server being reachable. The readiness check should exercise the minimal operation that requires the full stack — for Apple Container, that's `container list`; for a database, that's a connection ping; for an API, that's a health endpoint.

**The recurring meta-lesson:** This is now the fourth time (lessons #3, #16, #17, #18, #28) that "tests pass but runtime is broken" has appeared. The root cause is always the same: tests mock or bypass the external dependency boundary, so they can't catch missing runtime prerequisites. The fix is always the same: add a startup validation that exercises the real dependency and fails loud if it's not available. If this lesson needs to be written a fifth time, the problem isn't the code — it's the development checklist.

## 29. Scheduled Jobs Must Capture Their Delivery Target at Creation Time

**What happened:** Cron jobs fired successfully — the agent ran, produced output, and returned without error. But the user never received the message. Three independent bugs conspired:

1. **No delivery target captured.** The `CronTarget` type had a `deliverTo` field (`{ channel, to, accountId }`) for exactly this purpose, but the cron tool never populated it. When a user created a job via WhatsApp or Telegram, the job was persisted with `target: { agentId: "default" }` and no channel info. The type existed; the wiring didn't.

2. **Delivery fell through to terminal.** The cron delivery path reused `deliverHeartbeatEvent()`, which resolves the target from a `heartbeat:${agentId}` session. For cron jobs (which run in isolated `cron:` sessions), this session often didn't exist or had no channel recorded. The fallback: emit to `terminal:dm:local` — a session nobody was watching. The delivery "succeeded" (no error thrown, `failCount: 0`) while the message vanished.

3. **`timer.unref()` allowed silent process exit.** The cron timer called `setTimeout(...).unref()`, which tells Node.js "don't keep the process alive just for this timer." If no other active handles existed (no channels connected, no HTTP server), the process would exit and cron jobs would never fire. The comment even said "Don't keep the process alive just for cron" — as if that was a feature.

A bonus fourth bug: the LLM agent creating the job computed a Unix timestamp a year in the past (`1739719500000` = Feb 2025 instead of Feb 2026). Because `computeNextRun` for `type: "at"` returns the timestamp as-is with no validation, the job fired immediately on the next tick instead of at the scheduled time.

**Why it happened:** The cron system was built and tested as an isolated subsystem. Jobs could be created, persisted, scheduled, fired, and retried — all verified by 50+ unit tests. But the _delivery_ of results was an afterthought bolted on via the heartbeat path, and the _creation context_ (which channel the user is on) was never threaded into the tool.

This is the same pattern as lessons #11, #16, and #17: every component works in isolation, the pipeline between them is broken, and silent fallbacks (terminal delivery, `failCount: 0`) mask the failure.

**What we fixed:**

1. **Capture `deliverTo` at creation time.** The cron tool now receives session context (`CronToolContext`) via closure — same pattern as session tools and spawn tools. When a user creates a cron job from Telegram, the tool reads `session.channel` and `session.peerId`/`session.groupId` and populates `target.deliverTo`. The delivery target is baked into the persisted job.

2. **Use `deliverTo` for direct delivery.** The cron runner in `startup.ts` now checks `job.target.deliverTo` first. When present, it delivers directly via `deliverOutboundPayloads()` to the captured channel, bypassing the fragile heartbeat session lookup. Falls back to the old path only for legacy jobs without `deliverTo`.

3. **Removed `timer.unref()`.** The cron timer now keeps the process alive. If you start the gateway with cron enabled, it stays running.

4. **Reject past timestamps.** The cron tool now validates `type: "at"` timestamps and returns a clear error if the timestamp is more than 5 seconds in the past, including the current time in the error message so the LLM can self-correct.

5. **Injected delivery context into agent prompt.** Cron agents now receive a system note: "Your response will be automatically delivered to {channel}. Do not try to send messages yourself." This prevents the agent from wasting tokens trying to figure out how to send the message and cluttering the output with meta-commentary about missing credentials.

**Lesson:** Any system that creates a task for future execution must capture the _full delivery context_ at creation time, not resolve it at execution time. Session state is ephemeral — the channel the user was on, the chat ID, the group — may not be available hours or days later when the job fires. The job must be self-contained: it should know where to deliver its results without depending on any ambient session state.

The broader principle: **fire-and-forget systems need fire-and-deliver semantics.** If a cron job, webhook, or background task produces output, the question "where does this output go?" must be answered at creation time and persisted with the job — not deferred to a fragile runtime lookup.

**Checklist for scheduled/async features:**

1. When the user creates the job, what channel are they on? Capture it.
2. When the job fires, does it know where to send results without any session state? Verify it.
3. If delivery fails, does it fail silently or loud? Make it loud.
4. If a timestamp or schedule is invalid, does the system reject it at creation or silently misfire? Reject early.
5. Does the process stay alive long enough for the job to fire? Don't `unref()` timers that are the reason the process exists.

## 30. LLM Responses Are Never Clean JSON — Always Extract, Never Parse Directly

**What happened:** The deep work task classifier calls Haiku with a prompt that says "respond with JSON: `{ classification, reason }`." The classifier code did `JSON.parse(result.text)`. In unit tests with mocked providers, this worked perfectly — the mock returned clean `{"classification":"deep","reason":"..."}`.

In production, Haiku wrapped the response in markdown fences:

````
```json
{"classification": "deep", "reason": "multi-step research"}
```​
````

`JSON.parse()` threw on the backticks. The classifier caught the error and fell back to "quick" — as designed. But the fallback meant every complex message was silently misclassified. The classifier was working, just always returning the wrong answer.

**Why it's insidious:** The error handling was correct — no crashes, no unhandled rejections, graceful degradation. The _behavior_ was wrong in a way that was invisible without checking the logs (which had a `warn` message, but who checks warnings when nothing is broken?). The system appeared to work. Messages were being answered. Just via the slow path instead of deep work.

**What we fixed:** Added `extractJson()` — tries raw `JSON.parse` first, then regex extraction (`/\{[^}]*"classification"\s*:\s*"[^"]*"[^}]*\}/`) to pull JSON out of surrounding text, markdown fences, or prose. Also promoted the classifier success log from `debug` to `info` so successful classifications are visible in normal logs.

**Lesson:** When parsing LLM output:

1. **Never trust raw `JSON.parse()` on LLM text.** Models wrap responses in markdown fences, add preamble text ("Here's the JSON:"), or append explanations after the JSON. Always use an extraction function that handles surrounding content.
2. **Graceful degradation can hide silent misclassification.** A fallback to the safe default ("quick") is correct for resilience but wrong for correctness if it fires on every call. Log successful classifications at `info` level, not `debug` — you need to see them to know the classifier is actually classifying.
3. **Mock providers in tests return exactly what you tell them.** They never wrap responses in fences, add preamble, or format unexpectedly. The gap between mocked and real LLM output is where these bugs live. Consider adding a test case with fenced JSON: ``"`​`​`json\n{...}\n`​`​`"`` to catch this.

## 31. Agents Write Files — Mobile Users Can't Read Them

**What happened:** The deep work executor ran successfully. The Opus agent performed 5 web searches, synthesized a comprehensive research report, and wrote it to `~/.jinx/workspace/openclaw-research-report.md`. The agent also included a text summary in its response, which was delivered to WhatsApp. Everything worked.

But the user was on their phone. The `.md` file sitting on the laptop's filesystem was useless. The whole point of deep work is that the user sends a complex request from their phone and gets the result back on their phone. A file path is not a result.

**Why it happened:** The agent was designed as a desktop tool first. Its `write` tool writes to the local filesystem because that's where workspace files live. When deep work was added, the agent happily used the same tool — which worked correctly but delivered the result to the wrong place (disk instead of the messaging channel).

The agent's response text included a summary, so the user got _something_. But the full 5,000-word report with structured sections, tables, and citations was trapped on the laptop.

**What we fixed (belt-and-suspenders):**

1. **Delivery note in the prompt:** The deep work executor appends a system note: "Your entire response will be automatically delivered to {channel}. Include the FULL content in your response text — do not just write to a file, as the user may be on mobile." This makes the agent prioritize inline content over file writes.

2. **File extraction and attachment:** `extractWrittenFiles()` scans the agent's tool calls for `write` operations, reads each file from disk, and attaches them as `OutboundMedia` documents in the delivery payload. Both WhatsApp and Telegram `send()` methods handle media attachments — the file is sent as a document the user can open on their phone.

3. **Both channels wired for media:** WhatsApp already supported media sending. Telegram's `send()` was text-only — we added media handling via `sendTelegramMedia()` with filename and caption support.

The result: the user gets the full text inline (readable in the chat) AND the file as a downloadable document attachment (openable in any markdown viewer).

**Lesson:** When an agent can write files AND deliver results to a messaging channel, assume the user is on mobile. Two rules:

1. **Content must travel through the channel, not stay on disk.** A file path is not a deliverable. If the agent writes a file, either include the content inline in the response OR send the file as an attachment through the channel.
2. **Both paths should work simultaneously.** Inline text is readable immediately in the chat. File attachments are downloadable for later. Neither alone is sufficient — inline text gets truncated in long reports, and file attachments require opening a separate app. The belt-and-suspenders approach gives the user both options.

## 32. The Configured Credential That Was Silently Ignored

**What happened:** The user ran `claude setup-token` to create a long-lived (1-year) OAuth token and added it to `~/.jinx/.env` as `CLAUDE_CODE_OAUTH_TOKEN`. This is the highest-priority auth source — `resolveAuth()` checks it at line 9 before anything else. The token was correctly formatted, the `.env` file was loaded at startup, and the priority logic was correct.

But when a marathon session ran overnight, it hit a 401 authentication error. Investigation revealed the system was using the macOS Keychain token — a short-lived (~8 hour) OAuth token from `claude login` — instead of the configured `.env` token. The Keychain is the _fallback_, priority #3. Somehow the primary credential was being skipped.

**Root cause:** `readKeychainToken()` blindly returned `accessToken` from the Keychain without checking the `expiresAt` field. It returned expired tokens. But the deeper issue was **zero observability** — there was no logging of which auth source was selected, no startup validation that the configured credential was actually being used, and no way to tell at runtime whether the `.env` token or the Keychain token was active.

The user did everything right: created a long-lived token, put it in the right file, in the right format, with the right variable name. The system had the correct priority logic. But without observability, when the Keychain path was hit (for any reason — env var not loaded, timing issue, process restart without dotenv), it silently served the wrong token and nobody could tell.

**Why it's different from previous lessons:** This isn't a wiring gap (#16) or a stub (#1). The code was correct. The configuration was correct. The failure mode was _invisible correctness_ — the system worked but via the wrong path, and the only signal was an error 8 hours later when the wrong token expired.

**What we fixed:**

1. Added `CLAUDE_CODE_OAUTH_TOKEN` (long-lived setup token) to `~/.jinx/.env` — this is the actual fix
2. Auth error messages now point to `~/.jinx/.env` as the recommended credential source
3. Marathon auth error handler (401/authentication_error) immediately pauses with actionable fix instructions instead of burning retries

**Lesson:** When a system has a priority chain (env var → API key → Keychain), verify at startup that the _expected_ source is the one being used, not just that _some_ source provides a valid credential. Specifically:

1. **Log the auth source at boot.** "Auth: using CLAUDE_CODE_OAUTH_TOKEN from env" vs. "Auth: using Keychain OAuth token (expires in 7.8h)." One line of logging would have caught this immediately.
2. **Silent fallbacks are dangerous for credentials.** If the user configured a primary credential and the system falls back to a secondary, that's worth a WARNING, not silent degradation. The system "working" via the backup is worse than failing — it hides the misconfiguration until the backup expires.
3. **Expiring credentials need TTL checks.** Any auth source with an `expiresAt` field must be checked before use. Returning an expired token is worse than returning nothing — at least "no auth found" produces an immediate, diagnosable error.
4. **For long-running tasks, preflight the credential.** A 12-hour marathon should not start with a token that expires in 8 hours. Check at launch time, not when the token fails mid-execution.
