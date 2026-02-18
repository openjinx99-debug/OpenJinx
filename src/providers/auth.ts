import { execSync } from "node:child_process";
import type { ClaudeAuth } from "./types.js";

/**
 * Resolve Claude authentication credentials.
 * Priority: CLAUDE_CODE_OAUTH_TOKEN → ANTHROPIC_API_KEY → macOS Keychain → error.
 */
export function resolveAuth(): ClaudeAuth {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (oauthToken) {
    return { mode: "oauth", token: oauthToken };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return { mode: "api-key", key: apiKey };
  }

  // Try reading Claude Code's OAuth token from macOS Keychain
  const keychainToken = readKeychainToken();
  if (keychainToken) {
    return { mode: "oauth", token: keychainToken };
  }

  throw new Error(
    "No Claude authentication found. Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in ~/.jinx/.env, " +
      "or run `claude login` to store credentials in the Keychain.",
  );
}

/** Check if Claude auth is available without throwing. */
export function hasAuth(): boolean {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY) {
    return true;
  }
  return readKeychainToken() !== undefined;
}

/**
 * Read Claude Code's OAuth credentials from the macOS Keychain.
 * Claude Code stores them under service "Claude Code-credentials".
 */
function readKeychainToken(): string | undefined {
  if (process.platform !== "darwin") {
    return undefined;
  }

  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
      { encoding: "utf-8", timeout: 5_000 },
    ).trim();

    if (!raw) {
      return undefined;
    }

    // The keychain value is a JSON string containing the OAuth token
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Claude Code stores { claudeAiOauth: { accessToken: "...", refreshToken: "..." } }
    if (typeof parsed === "object" && parsed !== null) {
      const oauth = parsed.claudeAiOauth as Record<string, unknown> | undefined;
      if (oauth && typeof oauth.accessToken === "string" && oauth.accessToken.length > 0) {
        return oauth.accessToken;
      }
      // Fallback: check top-level token fields
      const token = parsed.oauthToken ?? parsed.token ?? parsed.accessToken;
      if (typeof token === "string" && token.length > 0) {
        return token;
      }
    }

    // If the raw value itself looks like a token
    if (typeof raw === "string" && raw.length > 20 && !raw.startsWith("{")) {
      return raw;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
