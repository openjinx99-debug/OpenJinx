---
name: skill-creator
display_name: Skill Creator
description: Create new skills for the Jinx assistant
tags: skills, development, meta
---

# Skill Creator

Help the user create new skills for Jinx.

## Usage

When the user wants to create a new skill, guide them through the process.

## Instructions

1. Ask the user what the skill should do
2. Determine required tools/binaries
3. Create the SKILL.md file with proper frontmatter
4. Place it in `~/.jinx/skills/<skill-name>/SKILL.md`

## SKILL.md Template

```markdown
---
name: <skill-name>
display_name: <Display Name>
description: <Brief description>
os: macos, linux
required_bins: <comma-separated binaries>
required_env: <comma-separated env vars>
tags: <comma-separated tags>
---

# <Display Name>

<Detailed instructions for the agent>

## Usage

<When to use this skill>

## Instructions

<Step-by-step guide>
```

## Frontmatter Fields

- `name` (required): Lowercase, hyphenated identifier
- `display_name`: Human-readable name
- `description`: Brief summary
- `os`: Comma-separated OS list (macos, linux, windows)
- `required_bins`: Binaries that must be on PATH
- `required_env`: Environment variables that must be set
- `tags`: Comma-separated tags for discovery
