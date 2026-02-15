---
name: session-logs
display_name: Session Logs
description: Review and search past conversation session logs
tags: memory, sessions, history
---

# Session Logs

Access and search past conversation session transcripts.

## Usage

When the user asks about past conversations or wants to find something from a previous session, search the session logs.

## Instructions

1. Session transcripts are stored as JSONL files in `~/.jinx/sessions/`
2. Each line is a JSON object with `role`, `text`, `timestamp`, and optional `toolCalls`
3. Use `glob` to find session files and `read` to examine them
4. Search across sessions using `grep` for keywords

## Approach

1. List available sessions: `glob ~/.jinx/sessions/*.jsonl`
2. Read recent sessions for context
3. Search for specific keywords across sessions
4. Present relevant excerpts with timestamps

## Notes

- Session files can be large; use line ranges when reading
- Most recent sessions are typically most relevant
- Session keys follow the pattern: `channel:type:id`
