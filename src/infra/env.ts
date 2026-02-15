/** Check if an environment variable has a truthy value. */
export function isTruthyEnv(key: string): boolean {
  const val = process.env[key]?.trim().toLowerCase();
  return val === "1" || val === "true" || val === "yes";
}

/** Get a required environment variable or throw. */
export function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return val;
}

/** Get an optional environment variable with a default. */
export function getEnv(key: string, defaultValue = ""): string {
  return process.env[key] ?? defaultValue;
}

/** Resolve Claude authentication token. Prefers OAuth, falls back to API key. */
export function resolveClaudeAuth():
  | { mode: "oauth"; token: string }
  | { mode: "api-key"; key: string }
  | undefined {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (oauthToken) {
    return { mode: "oauth", token: oauthToken };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return { mode: "api-key", key: apiKey };
  }

  return undefined;
}
