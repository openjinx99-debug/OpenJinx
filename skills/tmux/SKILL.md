---
name: tmux
display_name: tmux
description: Remote-control tmux sessions for interactive CLIs by sending keystrokes and scraping pane output
os: macos, linux
required_bins: tmux
install: brew install tmux
tags: tmux, terminal, session
---

# tmux Skill

Use tmux only when you need an interactive TTY. Prefer exec background mode for long-running, non-interactive tasks.

## Quickstart (isolated socket)

```bash
SOCKET="${TMPDIR:-/tmp}/jinx-tmux.sock"
SESSION=jinx-python

tmux -S "$SOCKET" new -d -s "$SESSION" -n shell
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- 'PYTHON_BASIC_REPL=1 python3 -q' Enter
tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION":0.0 -S -200
```

After starting a session, always print monitor commands:

```
To monitor:
  tmux -S "$SOCKET" attach -t "$SESSION"
  tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION":0.0 -S -200
```

## Targeting panes and naming

- Target format: `session:window.pane` (defaults to `:0.0`).
- Keep names short; avoid spaces.
- Inspect: `tmux -S "$SOCKET" list-sessions`, `tmux -S "$SOCKET" list-panes -a`.

## Sending input safely

- Prefer literal sends: `tmux -S "$SOCKET" send-keys -t target -l -- "$cmd"`.
- Control keys: `tmux -S "$SOCKET" send-keys -t target C-c`.
- For interactive TUI apps like Claude Code/Codex, send text and Enter as separate commands with a small delay:

```bash
tmux -S "$SOCKET" send-keys -t target -l -- "$cmd" && sleep 0.1 && tmux -S "$SOCKET" send-keys -t target Enter
```

## Watching output

- Capture recent history: `tmux -S "$SOCKET" capture-pane -p -J -t target -S -200`.
- Attaching is OK; detach with `Ctrl+b d`.

## Spawning processes

- For python REPLs, set `PYTHON_BASIC_REPL=1` (non-basic REPL breaks send-keys flows).

## Orchestrating Coding Agents (Codex, Claude Code)

tmux excels at running multiple coding agents in parallel:

```bash
SOCKET="${TMPDIR:-/tmp}/codex-army.sock"

# Create multiple sessions
for i in 1 2 3 4 5; do
  tmux -S "$SOCKET" new-session -d -s "agent-$i"
done

# Launch agents in different workdirs
tmux -S "$SOCKET" send-keys -t agent-1 "cd /tmp/project1 && codex --yolo 'Fix bug X'" Enter
tmux -S "$SOCKET" send-keys -t agent-2 "cd /tmp/project2 && codex --yolo 'Fix bug Y'" Enter

# Poll for completion (check if prompt returned)
for sess in agent-1 agent-2; do
  if tmux -S "$SOCKET" capture-pane -p -t "$sess" -S -3 | grep -q ">"; then
    echo "$sess: DONE"
  else
    echo "$sess: Running..."
  fi
done

# Get full output from completed session
tmux -S "$SOCKET" capture-pane -p -t agent-1 -S -500
```

## Cleanup

- Kill a session: `tmux -S "$SOCKET" kill-session -t "$SESSION"`.
- Kill all sessions on a socket: `tmux -S "$SOCKET" list-sessions -F '#{session_name}' | xargs -r -n1 tmux -S "$SOCKET" kill-session -t`.
- Remove everything on the private socket: `tmux -S "$SOCKET" kill-server`.
