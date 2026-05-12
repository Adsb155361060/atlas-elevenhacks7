# Phase 0 retrospective

End of Phase 0 (foundation). What went, what slipped, what to do differently
in Phase 1. Written 2026-05-13. Authored from the dev-plan exit-gate checklist
in `jarvis_dev_plan.md` §4.

## What's running end-to-end

```
"Hey Atlas" / hotkey   ──► wake:fired ──► AtlasState::Armed
                                              │
                                              ▼
                                       voice/mod.rs orchestrator
                                              │ (reads stored voice_id)
                                              ▼
                          WS wss://api.elevenlabs.io/v1/convai/conversation
                          (or signed-url flow when ELEVENLABS_API_KEY set)
                                              │
   ┌──────────────────────────────────────────┴──────────────────────────────┐
   │ outbound: per-session cpal mic (16kHz mono i16) → 250ms b64 chunks      │
   │ inbound:  audio_event → base64 PCM → playback ring buffer → speaker     │
   │           user_transcript → state::Thinking + atlas:transcript:user     │
   │           agent_response → atlas:transcript:agent                       │
   │           first audio chunk → state::Speaking                           │
   │           interruption → playback.interrupt(event_id) + state::Listening│
   │           ping → SendPong via outbound channel                          │
   │           client_tool_call → reply is_error=true (Phase 1+ wires tools) │
   │           vad_score → voice:vad event                                   │
   └─────────────────────────────────────────────────────────────────────────┘

Tray icon + tooltip + main window prompt + scrolling CaptionStrip + mini
overlay all mirror AtlasState in real time via tokio watch channel +
`atlas:state` Tauri events.
```

8 commits land Phase 0:

```
2e6c9e5 feat(ui):           phase 0.g — global hotkey, mini overlay, tray polish
5009860 feat(onboarding):   phase 0.f — ivc voice picker (stock / record / upload)
2a0bebc feat(voice):        phase 0.e — elevenlabs conv-ai websocket voice loop
d4d8c0c feat(wake):         phase 0.d — livekit-wakeword + cpal mic + state-driven tray
11d08ec feat(desktop):      phase 0.c — tauri 2 shell with tray, state machine, logging
7eb32c9 feat(prompts):      phase 0.b — agent prompt, config, and runbook
9837a6c feat(worker):       phase 0.a — claude proxy with openai-compat streaming
88ce2d7 chore:              initial repo scaffold + ADRs 0001-0018
```

(Phase 0.H — settings panel — bundles into the next commit alongside this retro.)

## Exit-gate checklist (dev plan §4)

| Item                                                                        | Status |
| --------------------------------------------------------------------------- | ------ |
| All eight commit gates green (0.A–0.H)                                      | ✅ |
| CI matrix green on all three OSes                                           | 🟡 not run yet — workflow file written; first push triggers it |
| `scripts/smoke.sh` end-to-end voice loop ≤ 1s perceived                     | 🟡 cannot run locally — needs user-supplied keys |
| 8-hour ambient test ≤ 3 false wakes                                          | 🟡 requires user-trained `hey_atlas.onnx` |
| Onboarding from blank profile ≤ 3 minutes                                    | ✅ wizard is 4 short screens; stock-voice path takes ~30s |
| CPU at idle-listen < 3% of one core; memory < 250MB                          | 🟡 unmeasured; runtime test |
| Sentry crash path verified                                                   | ❌ Sentry not wired yet (deferred to Phase 17) |
| ADRs 0001–0019 all marked Accepted                                           | ✅ |
| `docs/architecture.md` updated with as-built diagram                         | 🟡 still the stub from §0; refresh planned with this commit |

Net: Phase 0 is **code-complete**. The remaining 🟡 items all require either
user-supplied credentials (keys, .onnx) or a runtime test that needs the
desktop running with a real mic.

## What went well

1. **Graceful disable everywhere.** Every load-bearing module
   (`wake::start_if_configured`, `voice::start_if_configured`,
   `mini::toggle`, `hotkey::register`) logs a warning + continues when its
   config is missing. The app boots clean even with zero env vars.
2. **`cpal::Stream` is `!Send` discipline.** Discovered late in 0.D and
   re-applied cleanly in 0.E: `mem::forget` for app-lifetime streams (wake +
   playback), dedicated `std::thread` ownership for session-scoped streams
   (voice capture). One pattern, consistently applied.
3. **Single sink owner.** The WS client's `tokio::select!` loop owns the
   sink. All outbound writes — audio chunks, pongs, tool results, user
   messages — funnel through one `ClientCommand` channel. No concurrent
   write races to chase later.
4. **Two-window architecture is cheap.** Mini overlay reuses the same Vite
   bundle; URL query (`?mode=mini`) dispatches. Saved a build step + simplified
   capability declarations.
5. **Onboarding shape matches dev-plan §0.F.** Welcome → VoicePicker
   (3 tabs) → Privacy → Done. ~30 seconds for the stock-voice path; record
   path is 30s of natural speech + 5s upload.

## What surprised me / cost time

1. **Picovoice removed their Rust binding.** ADR 0014 (Porcupine) → tried
   rustpotter (unmaintained 2-year-stale candle-core fails to compile) →
   landed on `livekit-wakeword` (ADR 0019). Lost ~half a day to dependency
   archaeology. The result is *better* — pure-Rust ONNX, by LiveKit who also
   power ElevenLabs Conv AI WebRTC, no commercial license gate. Net positive,
   despite the detour.
2. **Disk pressure.** Tauri 2 + webkit2gtk-sys + livekit-wakeword (ort-tract,
   tract-nnef) + voice deps cranked target/ to ~3GB. `cargo clean` between
   phases was load-bearing — `/` ran at 99% multiple times. The user's
   non-Atlas disk usage is what's eating space; `~/.cache/google-chrome`
   alone was 1.9GB on the first cleanup pass.
3. **Tauri 2 `Image::from_bytes` doesn't exist.** Wanted to embed PNG bytes
   for tray icons via `include_bytes!` + decode at runtime. The actual path
   is `tauri::include_image!` macro which decodes at compile time → `Image<'static>`.
   Small ergonomic loss; clippy-clean.
4. **Multiple !Send + clippy + Tauri-managed-state interaction.** Voice
   playback worked first try because we leaked the stream. Voice capture
   per-session forced the dedicated-thread approach because cpal::Stream
   can't cross a tokio await in a multi-threaded runtime. Adds ~30 LOC of
   thread/channel ceremony; tested clean.
5. **`#![allow(dead_code)]` placement in protocol.rs**: the inner-attribute
   only takes effect when placed *before* any `use` statements. Got it
   wrong the first time; clippy errored; moved it; fixed.

## What I'd do differently in Phase 1

1. **Bundle Cargo.toml dep additions per-phase commit.** I had to walk back
   to add `multipart` + `stream` to reqwest in Phase 0.F when it should have
   been there at 0.E. Doesn't break anything, but the per-phase diff stayed
   tidier when planned ahead.
2. **Write the eval harness shape before any tool ships.** Phase 1 ships
   six tools. Skipping the eval harness even by one tool means each later
   tool's eval gets retrofitted. The dev plan §5.1 has the right shape;
   actually write the loader in `apps/worker/src/eval/run.ts` *first*.
3. **Decide on a shared audio capture earlier.** Phase 0.D and 0.E each
   open their own cpal::Stream on the default input. PulseAudio/PipeWire
   handle the multi-open fine in dev. But a single `audio` module that
   fan-outs via `tokio::sync::broadcast<Arc<Vec<i16>>>` would halve audio
   thread overhead and clarify the wake-vs-voice mic gating story. Plan to
   refactor when Phase 7 (file indexer / live captions) adds a third
   subscriber.

## Numbers worth recording

- **Repo size on disk (no target/, no node_modules)**: 1.4 MB Rust, 0.8 MB
  TS/TSX, 110 KB prompts/configs, 88 KB ADRs/docs.
- **target/ size for a clean dev build**: ~2.4 GB. Release with LTO + opt 3
  estimated ~150–250 MB binary post-strip.
- **Rust deps count**: 612 transitive after Phase 0.H (most pulled by Tauri
  + livekit-wakeword's tract + cpal+alsa-sys + reqwest+rustls).
- **Lines of code by area** (rough):
  - apps/worker — ~1200 (including tests)
  - apps/desktop/src-tauri — ~2100 (Rust)
  - apps/desktop/src — ~1400 (TS/TSX)
  - packages/prompts — ~700 (markdown + JSON)
  - docs — ~1300 (ADRs + runbooks + plans)

## Open items entering Phase 1

- **CI not yet exercised.** First push to GitHub triggers `ci-desktop.yml`
  (ubuntu/macos/windows matrix) and `ci-worker.yml`. Expect at least one
  iteration to fix per-OS surprises (macOS framework linker flags, Windows
  MSVC vs MinGW, etc.).
- **No Picovoice key + no `hey_atlas.onnx` yet.** Wake fires manually via
  push-to-talk or `fire_wake_test`. Phase 1 doesn't need the trained model
  but Day-3 dev-plan target says we should have it by end of Phase 0 — slip.
- **macOS / Windows test machines** not yet provisioned. Phase 4.3 / 4.4
  blocked until then; needs resolving by Week 5 per dev plan §30 open Q4.

Next: Phase 1 — six voice command tools (web_search, launch_app,
music_control, file system minimal, system_action, general Q&A). Eval
harness lands first (§5.1), then tools 1.1 through 1.6, then exit gate.
