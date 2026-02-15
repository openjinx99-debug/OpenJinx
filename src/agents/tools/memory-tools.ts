import fs from "node:fs/promises";
import path from "node:path";
import type { MemorySearchManager } from "../../memory/search-manager.js";
import type { AgentToolDefinition } from "../../providers/types.js";
import { isPathAllowed } from "../../infra/security.js";

export interface MemoryToolContext {
  /** Absolute path to the memory workspace directory (e.g. ~/.jinx/memory/). */
  memoryDir: string;
  /** Optional hybrid search manager. When provided, memory_search uses BM25 + vector search. */
  searchManager?: MemorySearchManager;
}

/**
 * Memory tool definitions with real implementations.
 * Provides hybrid search (BM25 + vector) and file reading scoped to the memory directory.
 * Falls back to plain-text grep search when no MemorySearchManager is provided.
 */
export function getMemoryToolDefinitions(ctx: MemoryToolContext): AgentToolDefinition[] {
  return [
    {
      name: "memory_search",
      description:
        "Mandatory recall step: search memory (semantic + keyword) before answering questions about prior work, decisions, dates, people, preferences, or todos. Returns relevant chunks with file path and line references.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for (case-insensitive)" },
          max_results: {
            type: "number",
            description: "Maximum results to return (default: 10)",
          },
          path_filter: {
            type: "array",
            items: { type: "string" },
            description: "Filter to specific file paths (glob patterns)",
          },
        },
        required: ["query"],
      },
      execute: async (input) => {
        const {
          query,
          max_results: maxResults = 10,
          path_filter: pathFilter,
        } = input as {
          query: string;
          max_results?: number;
          path_filter?: string[];
        };

        // Use hybrid search when a search manager is available
        if (ctx.searchManager) {
          const results = await ctx.searchManager.search({
            query,
            maxResults,
            pathFilter,
          });
          return {
            results: results.map((r) => ({
              file: path.relative(ctx.memoryDir, r.filePath),
              line: r.startLine,
              text: r.chunk,
              score: r.score,
              source: "memory" as const,
            })),
          };
        }

        // Fallback: grep-based search (no search manager)
        const results: {
          file: string;
          line: number;
          text: string;
          context: string;
          source: string;
        }[] = [];
        const queryLower = query.toLowerCase();

        try {
          await fs.access(ctx.memoryDir);
        } catch {
          return { results: [], message: "Memory directory does not exist yet" };
        }

        const entries = await fs.readdir(ctx.memoryDir, { recursive: true, withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile()) {
            continue;
          }
          if (!entry.name.endsWith(".md") && !entry.name.endsWith(".txt")) {
            continue;
          }

          const parentPath = entry.parentPath ?? (entry as { path?: string }).path ?? ctx.memoryDir;
          const fullPath = path.join(parentPath, entry.name);
          const relativePath = path.relative(ctx.memoryDir, fullPath);

          try {
            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(queryLower)) {
                // Grab surrounding context (2 lines before/after)
                const start = Math.max(0, i - 2);
                const end = Math.min(lines.length - 1, i + 2);
                const context = lines.slice(start, end + 1).join("\n");

                results.push({
                  file: relativePath,
                  line: i + 1,
                  text: lines[i],
                  context,
                  source: "memory",
                });

                if (results.length >= maxResults) {
                  break;
                }
              }
            }
          } catch {
            // Skip files that can't be read
          }

          if (results.length >= maxResults) {
            break;
          }
        }

        return { results };
      },
    },
    {
      name: "memory_get",
      description:
        "Read a specific memory file or section. Use after memory_search to pull only the needed lines and keep context small.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path within the memory directory",
          },
          from_line: { type: "number", description: "Start line number (1-indexed)" },
          num_lines: { type: "number", description: "Number of lines to read" },
        },
        required: ["path"],
      },
      execute: async (input) => {
        const {
          path: relativePath,
          from_line,
          num_lines,
        } = input as {
          path: string;
          from_line?: number;
          num_lines?: number;
        };

        const fullPath = path.resolve(ctx.memoryDir, relativePath);
        if (!isPathAllowed(fullPath, [ctx.memoryDir])) {
          throw new Error(`Path not allowed: ${relativePath}`);
        }

        const content = await fs.readFile(fullPath, "utf-8");

        if (from_line !== undefined) {
          const lines = content.split("\n");
          const start = Math.max(0, from_line - 1); // 1-indexed → 0-indexed
          const count = num_lines ?? lines.length - start;
          const slice = lines.slice(start, start + count);
          return {
            content: slice.join("\n"),
            path: relativePath,
            from_line: start + 1,
            lines: slice.length,
          };
        }

        return { content, path: relativePath };
      },
    },
  ];
}
