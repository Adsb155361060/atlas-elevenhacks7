# 0014 — Wake-word vendor: Picovoice Porcupine

- Date: 2026-05-12
- Status: Accepted

## Context

Wake word must be on-device (privacy + always-listening). Options: Picovoice Porcupine (proven, broad-platform Rust binding, free tier with non-commercial limit, paid Enterprise required for commercial public ship), openWakeWord (open-source, ML-based, less polished platform support), Snowboy (deprecated upstream), custom-trained model (high effort).

## Decision

Use **Picovoice Porcupine** for the on-device wake word. Custom keyword "Hey Atlas" trained via Picovoice Console. Commercial license required before public ship (V3); free tier sufficient through V1/V2 beta.

## Consequences

- Battle-tested, low CPU, cross-platform .ppn files supported.
- Picovoice commercial pricing kicks in before public launch — budget ~$2k/year for low-volume commercial license.
- Dependency on a single vendor for a critical input path; openWakeWord is a fallback to keep warm.

## Recovery

If Picovoice pricing or licensing becomes unworkable, swap to **openWakeWord** (also Rust-callable via ONNX runtime). Custom training under our control; ~1 week migration.
