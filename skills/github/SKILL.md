---
name: github
display_name: GitHub
description: Interact with GitHub repositories, issues, and pull requests
required_bins: gh
install: brew install gh
tags: github, git, code
---

# GitHub

Interact with GitHub using the `gh` CLI tool.

## Usage

When the user asks about GitHub repositories, issues, PRs, or other GitHub resources, use the `gh` CLI.

## Instructions

1. Use `gh` commands to interact with GitHub
2. For repository info: `gh repo view <owner/repo>`
3. For issues: `gh issue list`, `gh issue view <number>`
4. For PRs: `gh pr list`, `gh pr view <number>`
5. For creating: `gh issue create`, `gh pr create`

## Common Commands

- `gh repo view` — View repository details
- `gh issue list --limit 10` — List recent issues
- `gh pr list --limit 10` — List recent PRs
- `gh pr checks` — Check PR status
- `gh api repos/{owner}/{repo}/...` — Direct API access

## Notes

- Requires `gh` to be installed and authenticated
- Use `gh auth status` to verify authentication
