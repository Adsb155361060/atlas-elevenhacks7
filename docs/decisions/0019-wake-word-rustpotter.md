# 0019 — Wake-word engine: livekit-wakeword

- Date: 2026-05-13
- Status: Accepted (supersedes ADR 0014)

> Note on the filename: this ADR was originally drafted in favor of `rustpotter` after ADR 0014's Porcupine choice fell through. Rustpotter compiles failed (its 2-year-stale `candle-core 0.2.2` is incompatible with current `rand_distr` semantics; upstream unmaintained since 2023-10). We switched to `livekit-wakeword` before this ADR was committed, so the filename keeps the original number — no separate "0020" exists.

## Context

ADR 0014 selected Picovoice Porcupine for on-device wake-word detection. During Phase 0.D scaffolding we discovered Picovoice **removed** their Rust binding from `binding/` (only android/dotnet/flutter/ios/java/nodejs/python/react-native/react/web remain). The `porcupine` and `pv_porcupine` crates on crates.io are unrelated (Win32 utilities) or placeholder names.

We evaluated three open-source alternatives:

| Engine             | Status                       | Verdict                                                                                                    |
| ------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| rustpotter         | Unmaintained since 2023      | Pulls candle-core 0.2.2; fails to compile on current Rust due to half/rand_distr trait drift               |
| openWakeWord       | Python/ONNX, no Rust binding | Would require porting mel-spectrogram + ONNX wiring; ~1 week effort                                        |
| **livekit-wakeword** | Active (last release Apr 2026) | Pure-Rust ONNX via `ort-tract` (no native libs), built-in mel + embedding models, 16kHz PCM, by LiveKit (powers ElevenLabs Conversational Agent's WebRTC) |

`livekit-wakeword` wins:
- Pure-Rust ONNX backend (`ort-tract`) means no system libraries to install — single `cargo build` works cross-platform.
- Built-in mel spectrogram + embedding models embedded at compile time; only the lightweight wake-classifier `.onnx` lives in `resources/`.
- Maintained by the same team that built ElevenLabs Conv AI's WebRTC stack — natural alignment with Atlas's voice loop.
- Training new wake-words is a Python toolkit run independently (one-time per new wake word; produces a small `.onnx` file).
- License: Apache-2.0.

## Decision

Use **`livekit-wakeword` ≥ 0.1.3** for on-device wake-word detection. The wake classifier file `hey_atlas.onnx` lives at `apps/desktop/src-tauri/resources/wake/hey_atlas.onnx` (single cross-platform `.onnx`, gitignored).

Detection pattern: a 2.5-second rolling audio buffer with periodic inference (every ~200ms); cooldown of ~1.5 s between firings to suppress duplicates.

## Consequences

- Cargo dep: `livekit-wakeword = "0.1"` replaces what would have been `porcupine` / `rustpotter`.
- One ONNX classifier file (~50–200 KB) per wake word; cross-platform.
- Training "Hey Atlas" requires the LiveKit Python training toolkit at <https://github.com/livekit/livekit-wakeword> — a one-time setup, documented in `apps/desktop/src-tauri/resources/wake/README.md`.
- Until a custom `hey_atlas.onnx` is trained, dev fallback is the `fire_wake_test` Tauri command (debug builds) or the Phase 0.G global hotkey.
- Latency expectation: ~200ms detection window (configurable). For the dev-plan budget (`wake fire → WS open < 200ms`) this is on the edge; tune predict interval down to 100ms once Phase 0.D Day-3 ambient data is in.
- No commercial license gating (unlike Porcupine for public ship).

## Recovery

If `livekit-wakeword` quality proves insufficient for the accessibility wedge (atypical speech, broad accent coverage):
- Cheap step: enlarge training corpus + retrain the classifier; swap the `.onnx` file.
- Medium step: stack classifiers — load multiple `.onnx` files via `model.load_model()`; first to fire wins.
- Last resort: port openWakeWord's classifier zoo (300+ pre-trained wake words across many phrases) — ~1 week effort.
