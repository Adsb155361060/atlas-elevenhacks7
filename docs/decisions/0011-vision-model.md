# 0011 — Vision model: Gemini 3 Pro primary, Claude vision fallback

- Date: 2026-05-12
- Status: Accepted

## Context

Atlas's vision use cases (camera Q&A, screen Q&A, OCR-equivalents, tutorial mode) are heterogeneous. Gemini 3 Pro is currently strongest on object identification, complex screen understanding, and structured-output extraction. Claude vision (in Opus/Sonnet) is reliable on text/code-in-image and Claude-native tool use.

## Decision

- Primary vision model: **Gemini 3 Pro** for `vision_qa` (Phase 3, 7.5, 9.5).
- Lightweight / low-stakes vision tasks: **Gemini 3 Flash**.
- Fallback (if Gemini outage / cost spike / specific weakness): **Claude vision** in the active text-side model.
- Tool router picks based on task category + a runtime health check.

## Consequences

- Two vision vendors in production; manage two API keys + two rate limits.
- Cross-checking quality is easy (eval suite runs both for any regression test).
- Worker translates image inputs into both providers' formats; ~50 LOC.

## Recovery

If Gemini quality regresses or pricing shifts, flip primary to Claude vision via router config. Single-flag change.
