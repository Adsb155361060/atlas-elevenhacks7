# 0016 — IVC default voice during dev: stock ElevenLabs voice (Adam)

- Date: 2026-05-12
- Status: Accepted (dev-only default; users always re-pick during onboarding)

## Context

IVC voice picking is part of onboarding (Phase 0.F). Dev iterations skip onboarding constantly; needs a sane default. Should sound clearly assistant-ish (not uncanny) and have low latency on Flash v2.5.

## Decision

Default assistant voice during development = **ElevenLabs stock voice "Adam"** (well-tested, low-latency). Real users always pick their own during onboarding; this default never surfaces to a real first-launch.

## Consequences

- Dev fast loop unblocked when onboarding is skipped.
- No emotional connection during dev (which is correct — emotional resonance is the user's choice, not ours to fake).

## Recovery

Change the default by editing `apps/desktop/src-tauri/src/voice/defaults.rs`. Trivial.
