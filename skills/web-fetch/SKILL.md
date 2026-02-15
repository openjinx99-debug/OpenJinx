---
name: web-fetch
display_name: Web Fetch
description: Fetch and read content from a URL
required_bins: curl
tags: web, fetch, read
---

# Web Fetch

Fetch content from a specific URL and extract useful information.

## Usage

When the user provides a URL or asks you to read a web page, use curl to fetch the content.

## Instructions

1. Fetch the URL using curl with appropriate headers
2. Extract the main content (strip HTML if needed)
3. Summarize or present the relevant information

## Example

User: "Read https://example.com/article"

Run: `curl -sL "https://example.com/article" | head -200`

Present the extracted content in a readable format.
