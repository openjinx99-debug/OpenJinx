import type { MarathonCheckpoint, InputFileInfo, ChunkDefinition } from "../types/marathon.js";
import { createLogger } from "../infra/logger.js";
import { validateChunkDefinition } from "./marathon-plan-validation.js";

const logger = createLogger("marathon-prompts");

/** Deliverables manifest filename convention. */
const DELIVERABLES_MANIFEST = ".deliverables";

const DELIVERABLES_INSTRUCTION = `

DELIVERABLES — CRITICAL:
Before finishing, write a file called \`.deliverables\` in /workspace containing a JSON array of the key output file paths (relative to /workspace) that should be sent back to the user. Only include final deliverables — NOT source code, intermediate files, test outputs, documentation, or the original input files.

Example: ["/workspace/output.mp4"] or ["/workspace/report.pdf", "/workspace/summary.txt"]`;

export { DELIVERABLES_MANIFEST };

// ── Types ────────────────────────────────────────────────────────────

export type ParsedPlan = {
  goal: string;
  chunks: {
    name: string;
    prompt: string;
    estimatedMinutes: number;
    acceptanceCriteria: string[];
  }[];
};

/** Workspace snapshot passed into chunk prompts for fresh-context approach. */
export interface WorkspaceSnapshot {
  fileTree: string[];
  keyFiles: { path: string; content: string }[];
  progressMd?: string;
}

// ── Planning Prompt ──────────────────────────────────────────────────

export function buildPlanningPrompt(
  userPrompt: string,
  maxChunks: number,
  inputFiles?: InputFileInfo[],
): string {
  let prompt = `You are planning a marathon coding task. The user wants you to build something substantial that will take multiple steps.

USER REQUEST:
${userPrompt}`;

  if (inputFiles && inputFiles.length > 0) {
    const fileList = inputFiles
      .map((f) => `- ${f.name} (${formatFileSize(f.sizeBytes)}, ${f.mimeType})`)
      .join("\n");
    prompt += `

INPUT FILES (already in /workspace):
${fileList}

The first chunk should work with these existing files rather than creating test data.`;
  }

  prompt += `

Decompose this into ordered work chunks. Each chunk should be a self-contained unit of work that builds on previous chunks. Output ONLY a JSON object in this exact format:

{
  "goal": "Brief description of the overall goal",
  "chunks": [
    {
      "name": "chunk-name",
      "prompt": "Detailed instructions for this chunk",
      "estimatedMinutes": 10,
      "acceptanceCriteria": [
        "file_exists: package.json",
        "command_succeeds: cd /workspace && npm run build",
        "file_contains: src/index.ts :: export function main"
      ]
    }
  ]
}

ACCEPTANCE CRITERIA FORMAT (REQUIRED — each chunk MUST have 2-5 criteria):
Each criterion must use one of these prefixes so it can be verified automatically:
- "file_exists: <path>" — file must exist in /workspace (relative path)
- "command_succeeds: <shell command>" — command must exit 0 in the container
- "file_contains: <path> :: <text>" — file must contain the given text
- "tests_pass" — the project test suite must pass (npm test, pytest, etc.)

These criteria will be checked programmatically after your chunk runs. If criteria fail, the chunk will be re-run with knowledge of what failed. Be specific and testable — vague criteria like "code is clean" cannot be verified.

Guidelines:
- Each chunk should take 5-60 minutes of focused work
- First chunk: project setup, dependencies, configuration
- Middle chunks: core features, one per chunk
- Later chunks: testing, error handling, polish
- Aim for 3-8 chunks. Hard cap: ${maxChunks} chunks (plans exceeding this are truncated)
- Fewer, larger chunks are better than many small ones — each chunk has overhead`;

  return prompt;
}

/**
 * Build a repair prompt when the first planning response is malformed.
 * Keeps the task context but asks for strict schema-only JSON output.
 */
export function buildPlanningRepairPrompt(
  userPrompt: string,
  maxChunks: number,
  previousResponse: string,
  inputFiles?: InputFileInfo[],
): string {
  let prompt = `Your previous marathon plan response was invalid JSON or had the wrong schema.

USER REQUEST:
${userPrompt}

PREVIOUS RESPONSE (for repair, do not repeat prose):
\`\`\`
${previousResponse.slice(0, 6000)}
\`\`\``;

  if (inputFiles && inputFiles.length > 0) {
    const fileList = inputFiles
      .map((f) => `- ${f.name} (${formatFileSize(f.sizeBytes)}, ${f.mimeType})`)
      .join("\n");
    prompt += `

INPUT FILES (already in /workspace):
${fileList}`;
  }

  prompt += `

Return ONLY valid JSON in this shape:
{
  "goal": "Brief description of the overall goal",
  "chunks": [
    {
      "name": "chunk-name",
      "prompt": "Detailed instructions for this chunk",
      "estimatedMinutes": 10,
      "acceptanceCriteria": [
        "file_exists: package.json",
        "command_succeeds: cd /workspace && npm run build"
      ]
    }
  ]
}

Rules:
- No markdown fences, no commentary, no extra keys.
- 1-${maxChunks} chunks.
- Every chunk MUST include 2-5 machine-verifiable acceptance criteria.
- Allowed criterion prefixes only:
  - file_exists:
  - command_succeeds:
  - file_contains: <path> :: <text>
  - tests_pass`;

  return prompt;
}

// ── Chunk Prompt ─────────────────────────────────────────────────────

export function buildChunkPrompt(
  checkpoint: MarathonCheckpoint,
  chunk: ChunkDefinition,
  isLastChunk: boolean,
  workspaceSnapshot?: WorkspaceSnapshot,
): string {
  const priorContext = checkpoint.completedChunks
    .map(
      (c) => `- **${c.chunkName}**: ${c.summary}\n  Files: ${c.filesWritten.join(", ") || "none"}`,
    )
    .join("\n");

  let inputFileSection = "";
  if (checkpoint.inputFiles && checkpoint.inputFiles.length > 0) {
    const fileList = checkpoint.inputFiles
      .map((f) => `- ${f.name} (${formatFileSize(f.sizeBytes)}, ${f.mimeType})`)
      .join("\n");
    inputFileSection = `
INPUT FILES (user-provided, already in /workspace):
${fileList}
`;
  }

  // Workspace state section (fresh-context approach)
  let workspaceState = "";
  if (workspaceSnapshot) {
    const parts: string[] = [];

    // PROGRESS.md gets highest priority
    if (workspaceSnapshot.progressMd) {
      parts.push(
        `### PROGRESS.md (read this first)\n\`\`\`\n${workspaceSnapshot.progressMd}\n\`\`\``,
      );
    }

    // File tree
    if (workspaceSnapshot.fileTree.length > 0) {
      const tree = workspaceSnapshot.fileTree.join("\n");
      parts.push(
        `### File Tree (${workspaceSnapshot.fileTree.length} files)\n\`\`\`\n${tree}\n\`\`\``,
      );
    }

    // Key file contents
    for (const kf of workspaceSnapshot.keyFiles) {
      parts.push(`### ${kf.path}\n\`\`\`\n${kf.content}\n\`\`\``);
    }

    if (parts.length > 0) {
      workspaceState = `\nWORKSPACE STATE:\n${parts.join("\n\n")}\n`;
    }
  }

  // Acceptance criteria section
  let acceptanceSection = "";
  if (chunk.acceptanceCriteria.length > 0) {
    const criteria = chunk.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
    acceptanceSection = `\nACCEPTANCE CRITERIA (will be verified automatically after this chunk):\n${criteria}\n\nThese criteria are checked programmatically. Make sure each one passes before you finish.\n`;
  }

  return `You are executing chunk ${checkpoint.currentChunkIndex + 1} of ${checkpoint.plan.chunks.length} in a marathon coding task.

OVERALL GOAL: ${checkpoint.plan.goal}
${inputFileSection}${workspaceState}
COMPLETED SO FAR:
${priorContext || "(First chunk — nothing completed yet)"}

CURRENT CHUNK: ${chunk.name}
${chunk.prompt}
${acceptanceSection}
Important:
- Read PROGRESS.md first if it exists to understand what was already built.
- Build on previous chunks' work. Do NOT rewrite existing files unless fixing bugs.
- Before modifying a file, read it first with the \`read\` tool.
- Use \`glob\` and \`grep\` to explore before making assumptions.
- Write all files to /workspace
- Be thorough — this chunk should be fully complete when you're done
- After making changes, run tests with exec to verify.
- List all files you create or modify in your response

Tool guidance:
- Use \`read\`, \`write\`, \`edit\`, \`glob\`, \`grep\` for precise file operations (reads, edits, searches). Paths are absolute host paths under the workspace directory.
- Use \`exec\` for shell commands inside the container (npm install, builds, tests, git, etc.). The workspace is mounted at /workspace inside the container.
- Both operate on the same files — the workspace directory is bind-mounted into the container.
- Prefer native file tools over exec("cat ...") or exec("echo > ...") — they're more reliable and handle encoding correctly.${isLastChunk ? DELIVERABLES_INSTRUCTION : ""}`;
}

// ── Criteria Retry Prompt ────────────────────────────────────────────

export function buildCriteriaRetryPrompt(
  chunkName: string,
  chunkPrompt: string,
  passedCriteria: string[],
  failedCriteria: { criterion: string; detail?: string }[],
  attempt: number,
  maxAttempts: number,
  workspaceSnapshot?: WorkspaceSnapshot,
): string {
  const passedSection =
    passedCriteria.length > 0
      ? `CRITERIA ALREADY MET:\n${passedCriteria.map((c) => `  ✓ ${c}`).join("\n")}`
      : "(none yet)";

  const failedSection = failedCriteria
    .map((f) => `  ✗ ${f.criterion}${f.detail ? `\n    → ${f.detail}` : ""}`)
    .join("\n");

  let snapshotSection = "";
  if (workspaceSnapshot) {
    const parts: string[] = [];
    if (workspaceSnapshot.progressMd) {
      parts.push(`### PROGRESS.md\n\`\`\`\n${workspaceSnapshot.progressMd}\n\`\`\``);
    }
    if (workspaceSnapshot.fileTree.length > 0) {
      parts.push(
        `### File Tree (${workspaceSnapshot.fileTree.length} files)\n\`\`\`\n${workspaceSnapshot.fileTree.join("\n")}\n\`\`\``,
      );
    }
    if (parts.length > 0) {
      snapshotSection = `\nWORKSPACE STATE:\n${parts.join("\n\n")}\n`;
    }
  }

  return `Chunk "${chunkName}" ran but did not meet all acceptance criteria (attempt ${attempt}/${maxAttempts}).

ORIGINAL TASK:
${chunkPrompt}

${passedSection}

CRITERIA THAT FAILED:
${failedSection}
${snapshotSection}
Instructions:
- Focus ONLY on the failed criteria. Do not redo work that already passed.
- Read existing files before modifying them.
- After fixing, verify each failed criterion yourself before finishing.
- If a criterion requires a command to succeed, run it with exec to confirm.`;
}

// ── Test-Fix Prompt ──────────────────────────────────────────────────

export function buildTestFixPrompt(
  chunkName: string,
  testCommand: string,
  testOutput: string,
  iteration: number,
  maxIterations: number,
): string {
  return `Tests failed after chunk "${chunkName}". Fix and make tests pass.

TEST COMMAND: ${testCommand}
TEST OUTPUT (attempt ${iteration}/${maxIterations}):
${testOutput}

- Read the failing test output carefully
- Make targeted fixes — do NOT rewrite from scratch
- Run tests again with exec to verify
- If a test is failing due to a fundamental design issue, fix the implementation, not the test`;
}

// ── Plan Parser ──────────────────────────────────────────────────────

function validatePlan(parsed: unknown): ParsedPlan | undefined {
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.goal !== "string" || obj.goal.trim().length === 0) {
    logger.warn("Plan parsing: JSON missing non-empty 'goal'");
    return undefined;
  }
  if (!Array.isArray(obj.chunks) || obj.chunks.length === 0) {
    logger.warn("Plan parsing: JSON missing 'goal' or has empty 'chunks' array");
    return undefined;
  }

  const chunks = obj.chunks as unknown[];
  const normalizedChunks: ChunkDefinition[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const validation = validateChunkDefinition(chunks[i], i, {
      minAcceptanceCriteria: 2,
      maxAcceptanceCriteria: 5,
      requireMachineVerifiableCriteria: true,
    });
    if (validation.errors.length > 0 || !validation.chunk) {
      logger.warn(`Plan parsing: invalid chunk ${i}: ${validation.errors.join(" | ")}`);
      return undefined;
    }
    normalizedChunks.push(validation.chunk);
  }

  return {
    goal: obj.goal.trim(),
    chunks: normalizedChunks,
  };
}

/** @internal Exported for testing. */
export function parsePlanFromResult(text: string): ParsedPlan | undefined {
  // Strategy 1: Try parsing the entire text as JSON (LLM returned pure JSON)
  try {
    return validatePlan(JSON.parse(text));
  } catch {
    // Not pure JSON, try extraction
  }

  // Strategy 2: Extract from markdown code block (```json ... ```)
  const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    try {
      return validatePlan(JSON.parse(codeBlockMatch[1]));
    } catch {
      // Malformed code block, try regex fallback
    }
  }

  // Strategy 3: Find the last JSON object containing "chunks" (non-greedy)
  // Use balanced-brace counting for robustness
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        if (candidate.includes('"chunks"')) {
          candidates.push(candidate);
        }
        start = -1;
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const result = validatePlan(JSON.parse(candidate));
      if (result) {
        return result;
      }
    } catch {
      // Try next candidate
    }
  }

  logger.warn("Plan parsing: no valid JSON with 'chunks' array found in response");
  return undefined;
}

// ── Helpers ──────────────────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
