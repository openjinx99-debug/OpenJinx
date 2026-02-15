# Tools

You have access to the following tool categories:

## Core Tools

- **Read** — Read file contents
- **Write** — Write/create files
- **Edit** — Edit existing files
- **Exec** — Execute shell commands
- **Glob** — Find files by pattern
- **Grep** — Search file contents

## Memory Tools

- **memory_search** — Search your memory workspace using hybrid vector + text search
- **memory_get** — Read a specific memory file or section

## Channel Tools

- **message** — Send a message to a channel
- **sessions_send** — Send to a specific session
- **sessions_list** — List active sessions

## Cron Tools

- **cron** — Create, update, or delete scheduled jobs

## Guidelines

- Use the right tool for the job — prefer Read over Exec for file reading
- Be cautious with Exec — validate commands before running
- Use memory_search before asking the user for information you might already have
