# PRD: Onboarding V2 - Deterministic, Opinionated Setup

> **Status:** Draft (post-Marathon candidate)
> **Owner:** Product + Platform
> **Created:** 2026-02-16
> **Priority:** P1 (post-Marathon)

---

## Executive Summary

OpenJinx onboarding currently works, but it is not deterministic for new users:

- `jinx onboard` is a non-interactive bootstrap command.
- `/setup` is a guided Claude Code flow.
- Documentation has had conflicting language about auth and `.env` usage.

Onboarding V2 defines one explicit contract across product, docs, and tests:

1. `jinx onboard` is baseline bootstrap (filesystem + templates).
2. `/setup` is the guided opinionated setup path.
3. `jinx doctor` is mandatory validation and the source of truth for readiness.

The goal is to remove ambiguity, reduce time-to-first-success, and make setup reproducible.

---

## Problem Statement

### User-visible failures

1. Setup intent is unclear:
   - Users expect `onboard` to be a full wizard.
   - Actual behavior is bootstrap scaffolding only.
2. Auth guidance has been contradictory:
   - Messaging has implied both "no `.env`" and `.env`-based key setup.
3. Setup is not checklist-driven:
   - Users discover required/optional keys too late.
4. New users can finish setup but still fail first run:
   - Missing auth, missing allowlists, or channel config mistakes.

### Root causes

- No single canonical setup contract enforced across CLI + docs + skills.
- Weak regression coverage around onboarding command behavior and messaging.
- No formal acceptance criteria for setup UX quality.

---

## Product Goals

1. **Deterministic setup flow**: every user can reach "first successful message" reliably.
2. **Opinionated over optionality**: one recommended path, one fallback path.
3. **Secure-by-default onboarding**: channel lockdown defaults, clear credential handling.
4. **Low-friction recovery**: clear doctor output when setup is incomplete.

## Non-Goals

1. Rebuilding Marathon-related architecture (already in-flight and prioritized).
2. Designing voice ingestion, document ingestion, or delegated execution in this PRD.
3. Replacing existing auth architecture (env + Keychain) in this phase.

---

## Target Users

1. **Solo builder (technical)**: wants a fast and predictable first-time setup.
2. **Operator/product owner (semi-technical)**: wants explicit prerequisites and fewer choices.
3. **Contributor/dev teammate**: needs reproducible setup instructions for local validation.

---

## Proposed Onboarding Contract (V2)

### Setup Modes

1. **Guided path (recommended):** `claude` -> `/setup`
2. **Manual path (fallback):** `jinx onboard` -> edit `~/.jinx/.env` + `~/.jinx/config.yaml` -> `jinx doctor`

### Command Roles

1. `jinx onboard`: bootstrap only
   - Creates `~/.jinx`
   - Creates `~/.jinx/config.yaml` if missing
   - Ensures `~/.jinx/workspace/` templates exist
   - Reports auth status and next steps
2. `/setup` (Claude Code skill): guided config
   - Collects keys in sequence (required first, optional second)
   - Applies secure channel defaults (`dmPolicy: allowlist`, `groupPolicy: disabled`)
   - Runs `jinx doctor` at the end
3. `jinx doctor`: readiness gate
   - Must be green (or intentionally skipped checks) before onboarding is considered complete

---

## Detailed Requirements

### FR-1: Prerequisite checklist first

Before setup actions, present a key checklist:

- Required: Claude auth (Keychain OAuth or Anthropic API key)
- Optional: OpenAI, OpenRouter, Composio

### FR-2: Single source of truth for auth resolution

All onboarding surfaces must state the same chain:

1. env vars (shell + `~/.jinx/.env` auto-load)
2. macOS Keychain OAuth (Claude Code login)

### FR-3: Explicit mode clarity

Every setup document/command must distinguish:

- bootstrap (`onboard`)
- guided configuration (`/setup`)
- verification (`doctor`)

### FR-4: Secure defaults for messaging channels

When enabling WhatsApp/Telegram through guided setup:

- DM default: `allowlist`
- group default: `disabled`
- include explicit allowlists (`allowFrom` / `allowedChatIds`)

### FR-5: Deterministic artifact outputs

By end of onboarding:

- `~/.jinx/config.yaml` exists and validates
- `~/.jinx/workspace` templates exist
- optional `~/.jinx/.env` contains only user-provided keys

### FR-6: Doctor as completion gate

Onboarding completion criteria:

- no failing checks in `jinx doctor`
- warnings surfaced with remediation steps

### FR-7: Docs must reflect runtime truth

README, GETTING_STARTED, config examples, and onboarding skills cannot disagree on:

- `.env` behavior
- auth priority
- setup mode definitions
- config enum values

---

## UX Spec (High-Level)

### Guided Path (`/setup`)

1. Show 60-second overview of what setup will do.
2. Show required/optional key checklist.
3. Confirm home/bootstrap location (`~/.jinx`).
4. Run key collection in strict order:
   - Claude auth fallback
   - OpenAI (optional)
   - OpenRouter (optional)
   - Composio (optional)
5. Offer channel setup with secure defaults.
6. Run doctor and summarize ready/not-ready state with concrete fixes.

### Manual Path (`onboard`)

1. Bootstrap filesystem and config.
2. Print exactly where to put credentials (`~/.jinx/.env` or shell exports).
3. Point to guided `/setup` for users who want interactive setup.
4. Require `doctor` as next command.

---

## Technical Plan

### Phase 0 (completed now): Consistency baseline

1. Align CLI text and docs with actual behavior.
2. Align config example enums with schema.
3. Add unit coverage for onboarding command messaging/flow.

### Phase 1: Guided flow hardening

1. Introduce structured setup state file (`~/.jinx/setup-state.json`).
2. Add idempotent `/setup` rerun behavior (skip completed steps unless requested).
3. Add explicit "required key missing" stop conditions.

### Phase 2: Readiness and telemetry

1. Add onboarding completion marker when doctor passes.
2. Add anonymous local-only setup timing counters (optional, opt-in).
3. Add doc drift check in CI for key onboarding assertions.

---

## Success Metrics

1. **Time-to-first-success**: median <= 10 minutes for guided path.
2. **First-run readiness**: >= 90% of new setups pass `jinx doctor` on first attempt.
3. **Support friction**: >= 50% drop in setup-related ambiguity questions.
4. **Config correctness**: zero schema-invalid defaults in published setup examples.

---

## Test Strategy

1. **Unit**
   - `onboard` command behavior (creates files, messaging, auth hints).
   - auth resolution docs/examples lint checks (if introduced).
2. **Integration**
   - startup path with generated config and optional `.env`.
   - doctor checks for common setup permutations.
3. **System / live**
   - onboarding flow conversation tests (workspace mutations + end-state checks).
4. **Regression gate**
   - required onboarding docs and example snippets validated in CI.

---

## Risks and Mitigations

1. **Risk:** Documentation drifts again.
   - **Mitigation:** Add CI guard that verifies canonical phrases and enum examples.
2. **Risk:** `/setup` skill and CLI diverge over time.
   - **Mitigation:** Define onboarding contract file and reference it from both surfaces.
3. **Risk:** Too many optional choices increase drop-off.
   - **Mitigation:** Keep guided setup opinionated; optional steps are additive, not blocking.

---

## Open Questions

1. Should `onboard` optionally generate `~/.jinx/.env` from template by default?
2. **Resolved (2026-02-16):** `doctor --onboarding` now exists and reports readiness blockers with remediation hints.
3. Should we persist "setup complete" state for channel-by-channel readiness?
