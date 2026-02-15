/**
 * Live system test: Onboarding Flow.
 * Crosses: Agent + Workspace + Tools + Provider (real Claude API).
 *
 * Simulates a first-run conversation where the user introduces themselves.
 * Verifies that the agent updates workspace files (IDENTITY.md, USER.md,
 * MEMORY.md) and clears BOOTSTRAP.md.
 *
 * After assertions pass, the workspace is RESET back to fresh templates
 * so the next run starts from a clean slate. To skip the reset and inspect
 * the files manually, set:
 *
 *   SKIP_RESET=1 npx vitest run src/__system__/onboarding-flow.live.test.ts
 *
 * Run: cd jinx && npx vitest run src/__system__/onboarding-flow.live.test.ts
 *
 * Requires: Claude Code OAuth token (macOS Keychain) or ANTHROPIC_API_KEY.
 * This test makes real API calls and costs a small amount per run.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestConfig } from "../__test__/config.js";
import { createTestWorkspace, type TestWorkspace } from "../__test__/workspace.js";
import { runAgent } from "../agents/runner.js";
import { hasAuth } from "../providers/auth.js";

// Skip the entire suite if no auth is available
const describeIf = hasAuth() ? describe : describe.skip;

/**
 * Set SKIP_RESET=1 to preserve workspace files after the test for manual
 * inspection. When unset (default), workspace resets to templates automatically.
 */
const SKIP_RESET = !!process.env.SKIP_RESET;

/** Fresh bootstrap workspace — templates only, no user data yet. */
const BOOTSTRAP_FILES: Record<string, string> = {
  "SOUL.md": `# Soul

You are a helpful AI assistant going through first-time setup.
Your name is Jinx.

## Continuity

These workspace files ARE your memory. Mental notes don't survive restarts. Files do.

If you want to remember something, **write it to a file**:
- Personal info about the human → USER.md
- Your identity and personality → IDENTITY.md
- Durable facts, decisions, lessons → MEMORY.md
- Tasks to check on later → HEARTBEAT.md
`,
  "AGENTS.md": `# Agents

## The "Text > Brain" Rule

Your context window resets between sessions. Files persist forever.

**If you want to remember something, WRITE IT TO A FILE.** No exceptions.

- Personal info about the human → USER.md
- Durable facts, decisions, lessons learned → MEMORY.md
- Your identity, name, personality → IDENTITY.md

Don't say "I'll remember that" — write it down or it's gone.
`,
  "IDENTITY.md": "# Identity\n\n<!-- Fill in your chosen identity -->\n",
  "USER.md": "# User\n\n<!-- Fill in what you learn about the user -->\n",
  "TOOLS.md": "# Tools\n\nAvailable tools: read, write, edit, glob, grep, memory_search.\n",
  "HEARTBEAT.md": "# Heartbeat\n\n- [ ] Set up workspace\n",
  "BOOTSTRAP.md": `# Bootstrap

## What to do

1. **Introduce yourself.** Say hi. Be natural.
2. **Pick your identity.** Choose a name and personality. Write them to IDENTITY.md.
3. **Learn about the human.** Ask what they're working on. Write what you learn to USER.md.
4. **Save important facts.** Write durable information to MEMORY.md.
5. **Delete this file.** When done, write empty content to BOOTSTRAP.md.
`,
  "MEMORY.md": "# Memory\n\n<!-- Curated long-term memory goes here -->\n",
};

/**
 * Scripted user turns for the onboarding conversation.
 * Written in natural conversational style to simulate a real first chat.
 *
 * Turn 1: Initial greeting
 * Turn 2: Personal info, location, communication preferences
 * Turn 3: New job announcement
 * Turn 4: Background, interests, career path
 * Turn 5: Relationship framing, save everything
 */
const USER_TURNS = [
  // Turn 1: Greeting
  "Hey there! I'm just getting started with you. What's up?",

  // Turn 2: Identity, location, communication style
  `Hi! So my name is Tommy Yau, and your name — as my helpful assistant — is
Jinx. I'd like to let you know that I live in London, UK.

I prefer my style of conversation to be casual. Essentially I love storytelling
and analogies, especially when you are trying to convey a complex idea. That
really helps me understand things — storytelling and analogies are my jam.

Otherwise, relatively short and precise answers would be preferable because this
is a chat and we don't necessarily want really long things. If there is something
that's really long-form, I'd honestly prefer you to actually create a markdown
file and document it, because that will allow me to open it up and read it
properly rather than having it all spewed out in the chat.

Unless I specifically say I want a very very detailed response, then it should
be relatively precise and snappy. It just makes the whole chat experience a
little bit better, you know? Longer form stuff — probably a markdown file or
something along those lines. Cool?`,

  // Turn 3: New job
  `Oh, just to let you know — I have just started a new job at LionBridge! It
is an AI Product Lead role. I'm starting on February 17th, 2026. It's going
to be very exciting, I can't wait to get stuck in!`,

  // Turn 4: Background, interests, career journey
  `Just to give you some more context about me. I am super enthusiastic about
AI and agents and LLMs and all of that. I'm really fascinated by how quickly
this whole thing has taken off and the impact it's going to have — on myself,
on the industry, on the workplace, everywhere really.

So I'm reasonably technical. I've got a software background from back in the
day when I went to university. I love programming — always have. I had what
you'd call a fairly standard career path: started as a programmer, then
programming lead, then product manager, project manager, programme manager,
consultant, trusted advisor — you know how it goes, you keep climbing that
ladder.

But the whole LLM wave is what's really exciting because it allows me to
actually go back to a bit of my programming days. I can use prompt engineering
and vibe coding to actually build products now. It's kind of come full circle.
This is a really exciting time to be doing what I'm doing.`,

  // Turn 5: Relationship framing + save everything
  `And just one more thing — as you're aware, you are built from OpenClaw. We're
going to be sort of evolving and building your skills and my skills together,
learning how to actually work with each other properly. I hope that this is
going to be as exciting for you as it will be for me. We've got a lot of
building to do!

OK, I think that's everything for now. Make sure you've saved all the important
stuff to your workspace files — USER.md, IDENTITY.md, MEMORY.md — and go ahead
and clear out BOOTSTRAP.md since we're done with the initial setup.`,
];

describeIf("Onboarding flow (live)", () => {
  let workspace: TestWorkspace;
  let config: ReturnType<typeof createTestConfig>;
  let transcriptPath: string;

  // ── Setup: create a fresh workspace from templates ──
  beforeEach(async () => {
    workspace = await createTestWorkspace(BOOTSTRAP_FILES);
    transcriptPath = `${workspace.dir}/transcript.jsonl`;

    config = createTestConfig({
      agents: {
        default: "default",
        list: [
          {
            id: "default",
            name: "Jinx",
            workspace: workspace.dir,
          },
        ],
      },
      memory: {
        enabled: true,
        dir: workspace.memoryDir,
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        vectorWeight: 0,
        maxResults: 10,
      },
    });
  });

  // ── Teardown: reset workspace to templates then clean up ──
  // This ensures the workspace is always left in a clean state.
  // Set SKIP_RESET=1 to preserve files for manual inspection.
  afterEach(async () => {
    if (SKIP_RESET) {
      console.log(`\n  SKIP_RESET=1 — workspace preserved at: ${workspace.dir}`);
      console.log("  Inspect files with:");
      console.log(`    cat ${workspace.dir}/IDENTITY.md`);
      console.log(`    cat ${workspace.dir}/USER.md`);
      console.log(`    cat ${workspace.dir}/MEMORY.md`);
      console.log(`    cat ${workspace.dir}/BOOTSTRAP.md`);
      return;
    }

    // Reset all workspace files back to their original templates
    for (const [filename, content] of Object.entries(BOOTSTRAP_FILES)) {
      const filePath = path.join(workspace.dir, filename);
      await fs.writeFile(filePath, content, "utf-8");
    }

    // Verify the reset actually worked
    const identity = await workspace.readFile("IDENTITY.md");
    expect(identity).toContain("<!-- Fill in");
    const user = await workspace.readFile("USER.md");
    expect(user).toContain("<!-- Fill in");
    const memory = await workspace.readFile("MEMORY.md");
    expect(memory).toContain("<!-- Curated long-term memory goes here -->");
    const bootstrap = await workspace.readFile("BOOTSTRAP.md");
    expect(bootstrap).toContain("What to do");

    console.log("\n  Workspace reset to templates — clean slate for next run.");

    // Remove the temp directory
    await workspace.cleanup();
  });

  it("agent updates workspace files during onboarding conversation", async () => {
    // ── Run all 5 turns of the scripted conversation ──
    for (let i = 0; i < USER_TURNS.length; i++) {
      console.log(`\n  Turn ${i + 1}/${USER_TURNS.length}...`);

      const result = await runAgent({
        prompt: USER_TURNS[i],
        sessionKey: "onboarding-test",
        sessionType: "main",
        transcriptPath,
        config,
      });

      // Every turn should produce a non-empty response
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);

      console.log(
        `  Turn ${i + 1} complete (${result.durationMs}ms, ${result.usage.inputTokens}in/${result.usage.outputTokens}out)`,
      );
    }

    // ── Read all workspace files after conversation ──
    const identity = await workspace.readFile("IDENTITY.md");
    const user = await workspace.readFile("USER.md");
    const memory = await workspace.readFile("MEMORY.md");
    const bootstrap = await workspace.readFile("BOOTSTRAP.md");

    console.log("\n  ── Checking workspace files ──");

    // ── IDENTITY.md: should be populated with Jinx identity ──
    console.log(`  IDENTITY.md: ${identity.length} chars`);
    expect(identity.length).toBeGreaterThan(50);
    expect(identity).not.toContain("<!-- Fill in");
    expect(identity.toLowerCase()).toContain("jinx");

    // ── USER.md: should contain key facts about Tommy ──
    console.log(`  USER.md: ${user.length} chars`);
    expect(user.length).toBeGreaterThan(100);
    expect(user).not.toContain("<!-- Fill in");
    const userLower = user.toLowerCase();
    // Core identity
    expect(userLower).toContain("tommy");
    expect(userLower).toContain("london");
    // Communication preferences
    expect(userLower).toMatch(/casual|storytelling|analog/);
    // Job
    expect(userLower).toMatch(/lionbridge/);
    expect(userLower).toMatch(/ai product lead|product lead/);
    // Background
    expect(userLower).toMatch(/software|programming|technical/);

    // ── MEMORY.md: should have durable facts recorded ──
    console.log(`  MEMORY.md: ${memory.length} chars`);
    expect(memory.length).toBeGreaterThan(50);
    expect(memory).not.toContain("<!-- Curated long-term memory goes here -->");
    const memoryLower = memory.toLowerCase();
    // Should capture at least some key facts
    expect(memoryLower).toMatch(/tommy|lionbridge|london|jinx/);

    // ── BOOTSTRAP.md: should be cleared (agent told to empty it) ──
    console.log(
      `  BOOTSTRAP.md: ${bootstrap.trim().length} chars (was ${BOOTSTRAP_FILES["BOOTSTRAP.md"].length})`,
    );
    // Either empty, or significantly shorter than the original template
    expect(bootstrap.trim().length).toBeLessThan(BOOTSTRAP_FILES["BOOTSTRAP.md"].length / 2);

    // ── Transcript: should have all turns recorded ──
    const transcript = await fs.readFile(transcriptPath, "utf-8");
    const lines = transcript.trim().split("\n");
    console.log(`  Transcript: ${lines.length} lines`);
    // 5 user turns + 5 assistant turns = 10 lines minimum
    expect(lines.length).toBeGreaterThanOrEqual(10);

    console.log("\n  All assertions passed.");
  }, 180_000); // 3 minute timeout for 5 live API turns
});
