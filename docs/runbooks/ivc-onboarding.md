# Runbook — IVC voice onboarding

Stub. Filled at Phase 0.F.

## What it covers

The user-facing onboarding flow for picking the voice Atlas speaks in.

## Quality requirements for a clean 30s sample

- Quiet environment (< -50 dB noise floor)
- Single speaker, natural cadence
- Mixed content (not the same sentence three times)
- Mic 6–12 inches from speaker
- No reverb-heavy rooms

## Failure modes to handle

- Sample too quiet → prompt re-record
- Multiple speakers detected → prompt re-record
- Sample contains profanity / slurs → ElevenLabs moderation rejects → user-friendly explanation
- Sample sub-30s → reject before upload
