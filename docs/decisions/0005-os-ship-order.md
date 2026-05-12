# 0005 — OS ship order: Linux → macOS → Windows

- Date: 2026-05-12
- Status: Accepted

## Context

Each OS has distinct accessibility APIs (AT-SPI / AXUI / UIA), input simulation tools, and packaging stories. Doing all three in parallel as a solo dev is impractical. macOS accessibility APIs are the most mature and best-documented; Windows UIA is well-documented but Microsoft tooling is slowest; Linux AT-SPI is the most fragmented.

Linux first because it's the dev machine (ADR 0004). macOS second because AXUI maturity makes it the most demo-friendly second target. Windows third — solid APIs but the slowest packaging story.

## Decision

Ship-order: **Linux → macOS → Windows**. All three reach V1 parity by week 6 of the V1 schedule.

## Consequences

- CI runs all three from Phase 0.C (so we never accidentally Linux-lock APIs).
- Mac App Store submission deferred to V3; direct download via DMG at V1.
- Microsoft Store submission deferred to V3; direct MSIX at V1.
- Linux packaging (AppImage + .deb) at V1.

## Recovery

If macOS accessibility quality blocks Phase 4.3 progress, ship Linux-only V1 publicly and treat Mac/Win as V1.1. Acceptable because the dev plan was already structured this way in earlier iterations.
