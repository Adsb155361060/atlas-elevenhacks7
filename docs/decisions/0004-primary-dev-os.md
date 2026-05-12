# 0004 — Primary development OS: Linux

- Date: 2026-05-12
- Status: Accepted

## Context

Dev happens on the developer's existing Linux box. Cross-platform is the product's structural advantage over incumbents (Claude Desktop / Apple Intelligence are platform-locked). Choosing macOS as the primary dev OS would skew architectural decisions toward Mac and slow Linux/Windows ports later.

## Decision

**Linux is the primary development OS.** macOS and Windows are first-class targets shipped at V1 (Phase 4.3, 4.4) — not stubs. CI matrix verifies all three OSes on every PR. Mac + Windows test machines provisioned before Phase 4.3 (§30 open Q4).

## Consequences

- Phase 0.E voice loop validated on Linux first; macOS + Windows ports of audio capture / Tauri shell follow within Phase 0.
- AT-SPI quirks (Linux's weakest accessibility surface) get attention they'd otherwise miss.
- We may build features Linux-first that need rework on Mac/Windows; budget time for it.

## Recovery

If a critical OS API forces architecture changes that don't fit Linux, document the platform-specific divergence in `docs/architecture.md` and add a per-OS trait in `os_control/`. We already plan a trait-based abstraction, so this is a low-cost recovery.
