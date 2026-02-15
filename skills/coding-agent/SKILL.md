---
name: coding-agent
display_name: Claude Code
description: Run Claude Code as a sub-agent for coding tasks via background process
required_bins: claude
tags: coding, agent, claude-code
---

# Claude Code

Use Claude Code via bash for coding tasks. Run one-shot commands or background long-running work.

## One-Shot Tasks

```bash
cd ~/project && claude "Add error handling to the API calls"
```

## Background Mode

For longer tasks, run in background:

```bash
cd ~/project && claude "Build a snake game" &
```

**Why workdir matters:** The agent wakes up in a focused directory and doesn't wander off reading unrelated files.

## Parallel Issue Fixing with git worktrees

For fixing multiple issues in parallel, use git worktrees:

```bash
# 1. Create worktrees for each issue
git worktree add -b fix/issue-78 /tmp/issue-78 main
git worktree add -b fix/issue-99 /tmp/issue-99 main

# 2. Launch Claude Code in each
cd /tmp/issue-78 && pnpm install && claude "Fix issue #78: <description>. Commit and push." &
cd /tmp/issue-99 && pnpm install && claude "Fix issue #99: <description>. Commit and push." &

# 3. Create PRs after fixes
cd /tmp/issue-78 && git push -u origin fix/issue-78
gh pr create --repo user/repo --head fix/issue-78 --title "fix: ..." --body "..."

# 4. Cleanup
git worktree remove /tmp/issue-78
git worktree remove /tmp/issue-99
```

## Rules

1. **Be patient** - don't kill sessions because they're "slow"
2. **Parallel is OK** - run many Claude Code processes at once for batch work
3. **Use worktrees** for parallel fixes to avoid branch conflicts
