---
name: web-search
display_name: Web Search
description: Search the web using Perplexity Sonar via OpenRouter
tags: search, web
---

# Web Search

Search the web for current information using the `web_search` tool.

## Usage

When the user asks you to search the web, look something up, or needs current information, use the `web_search` tool with a concise search query.

## Instructions

1. Formulate a concise, specific search query from the user's request
2. Call the `web_search` tool with the query
3. Present the synthesized answer to the user
4. Include citations/URLs from the response so the user can verify

## Example

User: "What's the latest news about TypeScript?"

Call: `web_search({ query: "latest TypeScript news 2026" })`

Present the AI-synthesized answer along with citation URLs.
