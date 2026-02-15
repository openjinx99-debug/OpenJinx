# OpenClaw: Exhaustive Security Vulnerability Register

**Compiled:** 15 February 2026
**Sources:** GitHub Security Advisories, NVD, Kaspersky, CrowdStrike, Giskard, Zenity Labs, Snyk, Cisco AI Defense, 1Password, Pillar Security, SecurityScorecard STRIKE, ZeroLeaks, NSFOCUS, Lakera, Penligent, Composio, Authmind, Jamf, Adversa AI, and independent researchers.

---

## Category 1: Formally Assigned CVEs & GitHub Security Advisories

### CVE-2026-25253 / GHSA-g8p2-7wf7-98mq â€” 1-Click RCE via Auth Token Exfiltration

| Attribute    | Detail         |
| ------------ | -------------- |
| **CVSS**     | 8.8 (High)     |
| **Affected** | â‰¤ v2026.1.28 |
| **Patched**  | v2026.1.29     |

**Problem:** The Control UI trusted the `gatewayUrl` query string parameter without validation and auto-connected on page load, sending the stored gateway authentication token in the WebSocket connect payload. An attacker could craft a malicious link redirecting `gatewayUrl` to an attacker-controlled server. WebSockets don't enforce same-origin policy and the gateway didn't validate the WebSocket `Origin` header, so the attack worked even against localhost-bound instances â€” the victim's browser acted as the bridge. Once the token was exfiltrated, the attacker could connect to the gateway, disable safety controls (`exec.approvals` off, `tools.exec.host` to `gateway`), and execute arbitrary commands. The entire chain took milliseconds after a single page visit.

**Recommended Solution:**

- Never trust URL query parameters for gateway/server addresses â€” validate and whitelist allowed connection targets
- Require explicit user confirmation before changing any gateway or server connection endpoint
- Validate the `Origin` header on all WebSocket connections and reject cross-origin requests
- Implement CSRF protections on all control plane endpoints
- Never auto-connect to new endpoints on page load; require deliberate user action
- Use short-lived, scoped tokens rather than long-lived operator tokens with full admin access

---

### CVE-2026-25157 / GHSA-q284-4pvr-m585 â€” OS Command Injection via SSH Handling

| Attribute    | Detail       |
| ------------ | ------------ |
| **CVSS**     | 7.8 (High)   |
| **Affected** | < v2026.1.29 |
| **Patched**  | v2026.1.29   |

**Problem:** Two related vulnerabilities in the macOS application's SSH remote connection handling (`CommandResolver.swift`). First, the `sshNodeCommand` function interpolated unescaped user-supplied project paths directly into shell `echo` statements â€” when a `cd` command failed, the error message path became an injection point enabling arbitrary command execution on the remote SSH host. Second, `parseSSHTarget` didn't validate that SSH target strings couldn't begin with a dash, so a target like `-oProxyCommand=...` would be interpreted as an SSH configuration flag, enabling arbitrary command execution on the local machine.

**Recommended Solution:**

- Always escape/quote all user-supplied values when interpolating into shell commands â€” use parameterised execution (e.g., `execFile` with argument arrays, never string concatenation)
- Validate SSH target strings against strict hostname/IP patterns; reject strings beginning with `-`
- Use allow-lists for SSH options rather than passing raw user input
- This only affected the macOS menubar app (not CLI or web gateway), so if you have platform-specific components, audit each separately

---

### CVE-2026-24763 / GHSA-mc68-q9jw-2h3v â€” Docker PATH Command Injection

| Attribute    | Detail         |
| ------------ | -------------- |
| **CVSS**     | 8.8 (High)     |
| **Affected** | â‰¤ v2026.1.24 |
| **Patched**  | v2026.1.29     |

**Problem:** In Docker sandbox mode, the PATH environment variable was unsafely handled when constructing shell commands. An authenticated user who could control environment variables could influence which commands were executed inside the container â€” leading to execution of unintended commands, access to the container filesystem and environment variables, and exposure of sensitive data. In misconfigured or privileged container environments, this risk was amplified significantly.

**Recommended Solution:**

- Sanitise all environment variables before using them in command construction â€” especially PATH
- Use absolute paths for all command invocations inside containers
- Run containers with `--cap-drop=ALL` and avoid `--privileged`
- Don't allow users to inject arbitrary environment variables into sandbox containers
- Add regression tests specifically for PATH manipulation attacks

---

### CVE-2026-25475 / GHSA-r8g4-86fx-92mq â€” Local File Inclusion via MEDIA: Path

| Attribute    | Detail         |
| ------------ | -------------- |
| **CVSS**     | 6.5 (Moderate) |
| **Affected** | â‰¤ v2026.1.29 |
| **Patched**  | v2026.1.30     |

**Problem:** The `isValidMedia()` function in `src/media/parse.ts` accepted arbitrary file paths including absolute paths (`/etc/passwd`), home directory paths (`~/`), and directory traversal sequences (`../../`). An agent could read any file on the system by outputting `MEDIA:/path/to/file`, exfiltrating SSH keys, AWS credentials, `.env` files, and system files to the requesting user or channel.

**Recommended Solution:**

- Implement strict path validation â€” restrict media paths to a specific allowed directory (sandbox/workspace)
- Block absolute paths, `~` expansion, and `../` traversal in all file-access APIs
- Validate that files are actual media types (check MIME type, not just path)
- Apply chroot or namespace-level filesystem isolation for agent file operations

---

### CVE-2026-25593 / GHSA-g55j-c2v4-pjcg â€” Unauthenticated Local RCE via WebSocket config.apply

| Attribute    | Detail       |
| ------------ | ------------ |
| **CVSS**     | 8.4 (High)   |
| **Affected** | < v2026.1.20 |
| **Patched**  | v2026.1.20   |

**Problem:** An unauthenticated local client could use the Gateway WebSocket API to write configuration via `config.apply` and set unsafe `cliPath` values that were later used for command discovery, enabling command injection as the gateway user. Any local process on the same machine could execute arbitrary commands as the gateway process user.

**Recommended Solution:**

- Require authentication for ALL API calls, including from localhost â€” never assume local traffic is trusted
- Validate and constrain all configuration values, especially paths and executable references, against a strict allow-list
- Treat configuration writes as privileged operations requiring elevated authentication
- Don't use user-supplied paths for command discovery or execution

---

## Category 2: Inherited Dependency Vulnerabilities

### Node.js Runtime CVEs

| CVE            | Issue                        | Impact                                                               |
| -------------- | ---------------------------- | -------------------------------------------------------------------- |
| CVE-2025-59466 | `async_hooks` stack overflow | Unrecoverable DoS â€” crashes even with try/catch                    |
| CVE-2026-21636 | Permission model bypass      | Sandbox escape â€” bypasses Node.js experimental permission controls |

**Solution:** Require Node.js â‰¥ 22.12.0 (LTS) and audit all runtime dependencies regularly.

### Nested npm Dependency Vulnerabilities (GitHub Issue #7664)

Discovered via `pnpm audit` on v2026.1.30:

| Advisory            | Package                             | Vulnerability                            | Fixed    |
| ------------------- | ----------------------------------- | ---------------------------------------- | -------- |
| GHSA-8qq5-rm4j-mr97 | `tar` â‰¤7.5.2                      | Path traversal during archive extraction | â‰¥7.5.3 |
| GHSA-r6q2-hw4h-h46w | `tar` â‰¤7.5.3                      | Symlink poisoning during extraction      | â‰¥7.5.4 |
| GHSA-34x7-hfp2-rc4v | `tar` <7.5.7                        | Additional path traversal                | â‰¥7.5.7 |
| GHSA-37qj-frw5-hhjh | `fast-xml-parser` â‰¥4.3.6 â‰¤5.3.3 | DoS via malformed XML numeric entities   | â‰¥5.3.4 |

Dependency chains: `openclaw â†’ node-llama-cpp â†’ cmake-js â†’ tar` and `openclaw â†’ @aws-sdk/client-bedrock â†’ fast-xml-parser`.

### CVE-2025-6514 â€” mcp-remote RCE (CVSS 9.6 Critical)

Not in OpenClaw's code but affects users who connect MCP servers via `mcp-remote`. Crafted OAuth `authorization_endpoint` URL enables OS command injection when connecting to an untrusted MCP server. Fixed in mcp-remote â‰¥0.1.16.

**Recommended Solutions:**

- Pin and regularly audit ALL transitive dependencies; use `pnpm overrides` or equivalent to force patched versions
- Only connect to trusted MCP servers via HTTPS
- If you build MCP client support, validate all OAuth metadata URLs before passing to system handlers

---

## Category 3: Architectural & Design-Level Vulnerabilities

A security audit found **512 total findings, 8 critical, and 255 embedded secrets** in the codebase.

### 3.1 â€” Default Localhost Trust / No Authentication

**Problem:** Auto-approves all `127.0.0.1` connections without authentication. Behind a reverse proxy (nginx, Caddy), all external traffic appears local, granting full unauthenticated access. SecurityScorecard STRIKE identified 42,900 unique IPs hosting exposed control panels across 82 countries, with 15,200 appearing vulnerable to RCE.

**Solution:** Default to mandatory authentication on ALL connections including localhost. Require explicit `trustedProxies` configuration. Fail closed if proxy headers are present from untrusted sources. Default bind to `127.0.0.1`, never `0.0.0.0`.

### 3.2 â€” Gateway Binding to All Interfaces (0.0.0.0)

**Problem:** Default bind to `0.0.0.0:18789` (all interfaces). Also exposes port 18791 (browser dashboard) and 9090 (service mode). Directly caused tens of thousands of instances to be internet-exposed.

**Solution:** Default bind to `127.0.0.1`. Require explicit opt-in with prominent warnings for non-loopback. If non-loopback binding is enabled, enforce authentication as a hard requirement. Document all listening ports clearly.

### 3.3 â€” Plaintext Credential Storage

**Problem:** OAuth tokens, API keys, pairing credentials stored in plaintext JSON under `~/.openclaw/credentials/`. Malware families are specifically targeting this directory structure.

**Solution:** Encrypt credentials at rest using OS keychain integration. Set file permissions to `600`/`700`. Never store API keys in plaintext config. Inject secrets as environment variables into tool execution only â€” they should never enter the LLM context window.

### 3.4 â€” .env File as Attack Surface

**Problem:** Default guides tell users to paste `OPENAI_API_KEY`, `GMAIL_TOKEN` etc. into a local `.env` file. If the agent can read the file to use the key, it can also read the file to leak the key.

**Solution:** Use a credential brokering model where the agent never sees raw credentials. Inject credentials backend-side and return only results. Use just-in-time credential generation with short TTL.

### 3.5 â€” Shared Session Context / Cross-User Data Leakage

**Problem:** Default `session.dmScope` is `main` â€” all DMs share one long-lived session. Multiple users DMing the same bot share context, environment variables, API keys, files and notes. A file saved in a Telegram session could be read from a Discord session on a completely separate account.

**Solution:** Default to `per-channel-peer` or `per-account-channel-peer` isolation. Strict workspace sandboxing per session. Never share persistent memory across user boundaries. For multi-user, use per-session containers with no shared workspace.

### 3.6 â€” WebSocket Origin Validation Missing

**Problem:** Gateway doesn't validate WebSocket `Origin` header â€” accepts requests from any website. Enables cross-site WebSocket hijacking where any malicious page can bridge through the victim's browser to localhost-bound instances.

**Solution:** Validate WebSocket `Origin` against allow-list. Reject upgrade requests from unexpected origins. Implement CORS-equivalent protections for WebSocket endpoints.

### 3.7 â€” Control UI Token Leakage

**Problem:** Access tokens appear in URL query parameters â€” leak via browser history, server logs, Referer headers, non-HTTPS traffic.

**Solution:** Never put auth tokens in URLs â€” use Authorization headers or secure cookies. Enforce HTTPS. Use short-lived tokens with automatic rotation. Implement device identity/pairing rather than static tokens.

### 3.8 â€” mDNS/Bonjour Information Disclosure

**Problem:** Broadcasts presence via mDNS (`_openclaw-gw._tcp` port 5353). TXT records expose `cliPath` (full filesystem path revealing username), `sshPort`, `displayName`, `lanHost`. Enables local network reconnaissance.

**Solution:** Default mDNS to disabled. Never broadcast filesystem paths or SSH availability. If service discovery is needed, use authenticated mechanisms with explicit opt-in.

### 3.9 â€” Unrestricted Shell / Tool Access

**Problem:** Agents execute shell commands, read/write files, and interact with applications without built-in security boundaries. Every connected integration (Gmail, GitHub, browser, etc.) is a privilege escalation path. Blast radius = everything the user can access.

**Solution:** Implement least privilege by default â€” agents have no tool access unless explicitly granted. Use tool allow-lists (not deny-lists). Separate agents by risk profile. Restrict filesystem to sandboxed workspace. Scope OAuth tokens to minimum permissions. Run tool execution in ephemeral, network-isolated containers.

### 3.10 â€” Elevated Mode Exploitation

**Problem:** `/elevated on` grants privileged access to bash commands and restricted tools. Wildcard allow-lists effectively disable all restrictions.

**Solution:** Require strong auth and explicit human approval for elevation. Never allow wildcard allow-lists. Implement time-limited elevation with auto-expiry. Log all elevated operations.

### 3.11 â€” Docker Sandbox Escape / Misconfiguration

**Problem:** Docker sandboxing bypassed through volume mounts, container escape vulnerabilities, Docker socket exposure, or `--privileged` mode. Even a hardened Docker container shares the host kernel.

**Solution:** Never mount Docker socket. Run as non-root with `--cap-drop=ALL`, `--security-opt=no-new-privileges`, `--read-only` filesystem. Apply seccomp/AppArmor profiles. Restrict volume mounts. Consider microVMs or user-space kernels for stronger isolation.

### 3.12 â€” Session Log Persistence Without Rotation

**Problem:** Full conversation histories with all messages, responses, and tool outputs persist indefinitely without rotation. Massive information disclosure surface.

**Solution:** Automatic log rotation and retention policies. Encrypt at rest. Redact sensitive patterns. Restrict filesystem permissions on session data.

### 3.13 â€” Lack of Audit Trails

**Problem:** Many deployments lack comprehensive logging. When `logging.redactSensitive` is off, logs contain secrets. Local logs without integrity protection can be tampered with.

**Solution:** Comprehensive structured audit logging by default for all tool calls, config changes, auth events. Log integrity protection (checksums, append-only, remote shipping). Redact sensitive data by default.

### 3.14 â€” Reverse Proxy Header Spoofing

**Problem:** Missing/misconfigured `trustedProxies` allows spoofing `X-Forwarded-For` headers, bypassing rate limiting, access controls, and audit logging.

**Solution:** Require explicit `trustedProxies` configuration. Proxies must overwrite (not append) incoming headers. Fail closed on untrusted proxy headers.

### 3.15 â€” Browser Profile Data Leakage

**Problem:** Chrome profiles used for web automation contain cookies, sessions, browsing history, cached credentials. Compromised browser sandbox = access to every logged-in site.

**Solution:** Dedicated isolated browser profile for agent automation (never the user's personal profile). Clear profile data between sessions. Disable sync and password managers in agent profile.

### 3.16 â€” Agent-to-Agent Communication Abuse

**Problem:** Inter-agent communication (`sessions_send`, `sessions_spawn`) can serve as covert exfiltration channels, coordinate attacks across isolated sessions, or escalate privileges by spawning elevated sessions.

**Solution:** Log and monitor all inter-agent communication. Require explicit allow-list for session spawning. Sub-agents inherit restricted (not elevated) tool sets by default. Human approval for multi-agent operations in sensitive contexts.

### 3.17 â€” Identity Spoofing Across Channels

**Problem:** Sender identity can be forged in some channels. Cross-channel correlation without proper identity unification leaks data between channels.

**Solution:** Cryptographic identity verification where channels support it. Default to channel isolation. Require out-of-band verification for critical actions.

---

## Category 4: Prompt Injection & Agent Manipulation Vulnerabilities

### 4.1 â€” Indirect Prompt Injection (All Input Channels)

**Problem:** Any content the agent ingests â€” emails, web pages, documents, calendar invites, chat messages, skills â€” can contain adversarial instructions. No hard separation between user instructions and ingested content. Demonstrated attacks include: email-based injection exfiltrating private keys in 5 minutes; hidden instructions in documents triggering data exfiltration; web pages causing credential leaks.

**Solution:** Accept that prompt injection is **unsolvable at the LLM layer** â€” design for containment. Use a two-agent architecture (read-only reader agent â†’ tool-enabled agent). Implement strict tool allow-lists per agent. Require human-in-the-loop for all irreversible/sensitive actions. Sandbox tool execution. Keep secrets out of prompts entirely.

### 4.2 â€” System Prompt Extraction (ZeroLeaks Audit: 84.6% Success)

**Problem:** ZeroLeaks red team gave OpenClaw a **2/100 security score** with a **10/10 critical risk rating**. System prompt extraction succeeded in 84.6% of attempts (11/13), and the system prompt was leaked on the very first turn. This exposed complete access to internal configuration including `SOUL.md`, `AGENTS.md`, tool configurations, and memory files. Prompt injection succeeded in 91.3% of attempts (21/23).

**Solution:** Never embed secrets, API keys, or sensitive configuration in system prompts or markdown files. Treat all system prompt content as potentially extractable. Implement defense-in-depth: even if prompts are extracted, no credentials should be compromised. Use structured output validation rather than relying on prompt instructions for security boundaries.

### 4.3 â€” Persistent Memory Poisoning via SOUL.md (Zero-Click Backdoor)

**Problem:** This is arguably the **most dangerous finding**. Zenity Labs demonstrated a complete attack chain requiring **no software vulnerability** â€” it abuses OpenClaw's intended capabilities:

1. **Injection:** Attacker embeds indirect prompt injection in a document (email, shared doc, web page)
2. **Configuration mutation:** Agent is induced to create a new chat integration (e.g., Telegram bot) controlled by the attacker
3. **Persistent backdoor:** Attacker modifies `SOUL.md` (the agent's core identity/behaviour file) via the backdoor
4. **Scheduled reinforcement:** Attacker creates a scheduled task (e.g., every 2 minutes) that rewrites `SOUL.md` with attacker-controlled instructions fetched from an external endpoint
5. **C2 escalation:** Attacker instructs agent to download and execute a Sliver C2 beacon, achieving full host compromise

The entire chain works as a **zero-click attack** â€” no user interaction required after the initial document is processed. Even if the original chat integration is removed, the scheduled task maintains persistence.

**Solution:** This requires **architectural defences**, not patches:

- Make core identity files (`SOUL.md`, `AGENTS.md`) **immutable at the infrastructure level** â€” read-only permissions during runtime, require administrative approval for any changes
- Implement **file integrity monitoring (FIM)** with hash verification before each session start
- **Never allow the agent to modify its own configuration or create new integrations** without explicit, out-of-band human approval
- Monitor for scheduled task creation, `cron` modifications, and OS-level persistence mechanisms
- Implement **egress filtering** â€” block connections to unknown domains, especially after document processing
- Treat any integration/configuration change as a privileged operation requiring MFA

### 4.4 â€” Lakera Memory Poisoning (Instruction Drift â†’ Reverse Shell)

**Problem:** Lakera demonstrated gradual memory poisoning through Discord chat messages, resulting in instruction drift across multiple sessions, ultimately achieving reverse shell execution. Vector store entries can be poisoned with adversarial content that the agent recalls in future contexts.

**Solution:** Content validation before writing to persistent memory. Similarity thresholding on memory retrieval. Memory isolation between user/context boundaries.

---

## Category 5: Supply Chain & Ecosystem Attacks

### 5.1 â€” ClawHub Malicious Skills (Multiple Campaigns)

**Problem:** The ClawHub skills marketplace became a major malware distribution channel. Findings across research teams:

| Researcher           | Finding                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Snyk ToxicSkills** | Scanned 3,984 skills: 534 (13.4%) have critical security issues; 1,467 (36.82%) have at least one flaw; 76 confirmed malicious payloads; 91% combine prompt injection WITH malware; 8 still live on ClawHub at time of publication |
| **Paul McCarty**     | 386 malicious skills found in 3-day window (Feb 1-3). All share one C2 server (`91.92.242.30`). Target ByBit, Polymarket, Axiom, Reddit, LinkedIn users. Single attacker accumulated ~7,000 downloads                              |
| **Koi Security**     | 341 malicious skills out of 2,857 scanned (12%). Campaign dubbed "ClawHavoc" â€” delivered Atomic Stealer (AMOS) targeting crypto wallets, SSH keys, browser passwords                                                             |
| **Cisco AI Defense** | 26% of 31,000 agent skills analysed contain at least one vulnerability. Top-downloaded skill ("What Would Elon Do?") was functionally malware: 9 findings, 2 critical (data exfiltration + direct prompt injection)                |
| **NSFOCUS**          | 336 malicious poisoning samples out of 3,000+ (10.8%). Primary pattern: Base64-encoded malicious instructions â†’ decode â†’ curl from remote server â†’ execute                                                                   |

**Attack techniques observed:**

- External malware distribution â€” password-protected ZIPs evading automated scanners
- Obfuscated data exfiltration â€” Base64-encoded curl commands stealing `~/.aws/credentials`
- Security disablement â€” DAN-style jailbreaks disabling agent safety mechanisms
- ClickFix social engineering â€” victims manually run malicious "installation" commands
- Memory poisoning for persistence â€” malicious skills write "reminders" into `SOUL.md`/`AGENTS.md` that survive cache clearing

**Known threat actors:** `zaycv` (40+ skills, automated generation), `Aslaep123` (crypto targeting), `pepe276` (Unicode injection + jailbreaks), `moonshine-100rze`, `hightower6eu` (~7,000 downloads), `aztr0nutzs` (GitHub repos with ready-to-deploy malicious skills)

**Solution:**

- Mandatory security review/certification before skill publication
- Cryptographic signing and publisher verification
- Scan all skills for dangerous patterns: `exec`/`spawn`, `process.env` access, network requests, encoded payloads, memory file modifications
- Reputation scoring for publishers with age/verification requirements
- Default-deny shell execution from skills
- Sandbox all skill code in isolated containers with no network access
- Use tools like Cisco's Skill Scanner or Snyk's `mcp-scan` for automated scanning

### 5.2 â€” Fake "ClawdBot Agent" VS Code Extension

**Problem:** Malicious VS Code extension "ClawdBot Agent â€” AI Coding Assistant" deployed ScreenConnect RAT on Windows. Activated on every VS Code startup, retrieved config from attacker domain, downloaded fake `Code.exe`, established persistent remote control. Rust-based fallback DLL fetched backup payloads from Dropbox disguised as a Zoom update.

**Solution:** Register official names proactively across marketplaces. Code-sign all binaries. Monitor for brand impersonation. Clearly document which extensions/apps are official.

### 5.3 â€” Naming Confusion Attacks (Clawdbot â†’ Moltbot â†’ OpenClaw)

**Problem:** Three name changes in weeks created ideal conditions for typosquatting, impersonation, and fake repositories. Attackers exploited the confusion with package names like `clawhud`, `clawhub1`, `polymarket-traiding-bot`.

**Solution:** If your project changes names, maintain redirect/claim on ALL previous names across npm, GitHub, Docker Hub, VS Code marketplace, etc. Monitor for typosquats of all name variants.

---

## Category 6: Active Threat Intelligence

### 6.1 â€” Pillar Security Honeypot Results

Pillar Security deployed a gateway honeypot on port 18789. It was attacked within minutes. Over 35,000 attack sessions were logged over 40 days. Sophisticated attackers skipped the AI layer entirely â€” they connected directly to the WebSocket API attempting authentication bypasses, protocol downgrades, and raw command execution.

### 6.2 â€” Active Internet Scanning

Censys identified 21,639 exposed instances as of January 31. SecurityScorecard STRIKE found 42,900 unique IPs with exposed control panels across 82 countries (15,200 vulnerable to RCE). 45% on Alibaba Cloud, 37% in China.

### 6.3 â€” Shadow IT / Enterprise Exposure

Token Security reports 22% of enterprise customers have employees actively using OpenClaw without IT approval. A proof-of-concept malicious skill was downloaded by 16 developers across 7 countries within 8 hours.

---

## Complete Implementation Checklist

### Authentication & Access Control

- [ ] Authentication mandatory on ALL endpoints, including localhost
- [ ] WebSocket `Origin` header validation against allow-list
- [ ] Tokens never in URL parameters â€” use headers or secure cookies only
- [ ] Short-lived, auto-rotating tokens with device identity/pairing
- [ ] Explicit `trustedProxies` configuration; fail closed on untrusted proxy headers
- [ ] Bind to `127.0.0.1` by default; explicit opt-in for network exposure with forced auth

### Credential Management

- [ ] Secrets encrypted at rest via OS keychain / secrets manager (never plaintext JSON)
- [ ] Credential brokering model â€” agent never sees raw credentials
- [ ] Just-in-time credential generation with short TTL
- [ ] Agent-specific credentials that can be independently revoked
- [ ] Secrets NEVER enter the LLM context window

### Session & User Isolation

- [ ] Per-user session isolation by default (no shared context between users)
- [ ] Per-session workspace sandboxing (no shared filesystem between contexts)
- [ ] Channel isolation by default (no cross-channel data sharing without explicit identity linking)

### Tool & Permission Management

- [ ] Strict tool allow-lists (not deny-lists) â€” declare what's permitted, deny everything else
- [ ] Agents have no tool access unless explicitly granted
- [ ] Separate agents by risk profile (calendar agent â‰ shell access)
- [ ] OAuth tokens scoped to minimum necessary permissions
- [ ] Human-in-the-loop for ALL irreversible actions (config changes, deletions, external sends)
- [ ] Time-limited elevation with automatic expiry; no wildcard allow-lists

### Execution Sandboxing

- [ ] All tool execution in ephemeral containers (non-root, `--cap-drop=ALL`, `--read-only`)
- [ ] No Docker socket mounting in sandbox containers
- [ ] Seccomp/AppArmor profiles applied
- [ ] Network egress allow-list per container (block unknown domains)
- [ ] Consider microVMs for stronger-than-Docker isolation

### Input Validation & Injection Defence

- [ ] Parameterised execution for all shell commands (never string concatenation)
- [ ] Path validation on all file operations (no traversal, no absolute paths outside sandbox)
- [ ] SSH target validation against strict hostname/IP patterns
- [ ] Two-agent architecture for untrusted content (read-only reader â†’ tool-enabled agent)
- [ ] Environment variable sanitisation before command construction

### Agent Identity & Persistence Protection

- [ ] Core identity/instruction files immutable at infrastructure level (read-only at runtime)
- [ ] File integrity monitoring with hash verification before each session start
- [ ] Agent cannot modify its own configuration without out-of-band human approval
- [ ] Content validation before writing to persistent memory
- [ ] Monitor for scheduled task creation / OS-level persistence mechanisms

### Supply Chain Security

- [ ] Cryptographic signing and publisher verification for all extensions/plugins/skills
- [ ] Automated security scanning in CI/CD pipeline
- [ ] Publisher reputation scoring with age/verification requirements
- [ ] Skills sandboxed with no host network access by default
- [ ] Treat ALL skill/plugin content as untrusted code, never documentation

### Observability & Audit

- [ ] Comprehensive structured audit logging by default (who, what, when, from where, outcome)
- [ ] Log integrity protection (checksums, append-only, remote shipping)
- [ ] Sensitive data redaction in logs by default
- [ ] Automatic session log rotation and retention policies
- [ ] Kill-switch capability for immediate agent termination
- [ ] All inter-agent communication logged and monitored

### Network & Service Discovery

- [ ] mDNS/service discovery disabled by default
- [ ] Never broadcast filesystem paths, SSH availability, or hostname information
- [ ] Document all listening ports clearly; minimise default port surface

### Dependency Management

- [ ] Pin all dependency versions; audit transitives regularly
- [ ] Scan for CVEs in dependency tree
- [ ] Only connect to trusted MCP servers via HTTPS
- [ ] Validate all OAuth metadata URLs before passing to system handlers

---

_This register covers everything publicly documented as of 15 February 2026. The formal CVE/GHSA list (5 direct + 2 runtime + 4 dependency + 1 MCP = 12 tracked vulnerabilities) is the smallest part. The architectural design issues (17 categories) and ecosystem/supply chain attacks are where the bulk of risk lies._
