# 0006 — Desktop framework: Tauri 2

- Date: 2026-05-12
- Status: Accepted

## Context

Two viable cross-platform desktop frameworks: Tauri 2 (Rust core + webview UI; ~10MB binaries; native performance; newer ecosystem) and Electron (Node.js + Chromium; ~100MB binaries; huge library ecosystem; familiar to web devs).

Atlas runs all day in the background, captures mic and camera continuously, performs OS-level a11y traversal — performance matters. Tauri's Rust core is also the right home for the low-level audio + a11y work; Electron would require native add-ons in C++/Rust anyway.

## Decision

Use **Tauri 2** for the desktop app. Rust + React + TypeScript + Vite. Tauri plugins for store, fs, shell, os, global-shortcut, log; sidecar binaries for tools where shelling out is the only option.

## Consequences

- Smaller binary (~10MB) makes distribution faster, especially relevant for accessibility users on lower-bandwidth connections.
- Rust gives direct access to cpal (audio), nokhwa (camera), atspi (Linux a11y), accessibility-sys (Mac), uiautomation (Windows) — no marshaling through Node FFI.
- Smaller ecosystem than Electron means more first-principles work for IPC, packaging, and niche integrations. Acceptable trade.
- Tauri 2 specifically (not v1) — better plugin API, mobile-platform path open if we ever want it.

## Recovery

If Tauri proves to block a critical capability (most likely: WebGL2 / WebGPU edge cases in the artifact surface), evaluate Electron migration. Cost: ~2 weeks given how thin the UI shell is by design. Most logic lives in Rust + Worker and is framework-agnostic.
