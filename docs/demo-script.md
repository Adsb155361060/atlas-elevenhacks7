# Demo script — ElevenHacks 7

A 90-second walkthrough designed to exercise every shipped voice-loop primitive in order.

## Pre-flight (judge runs this once)

1. Drag **Atlas.app** to `/Applications`.
2. Right-click → Open (Gatekeeper bypass; one-time).
3. Grant microphone permission at the system prompt.
4. Complete onboarding:
   - Pick a stock voice (or record one — the wizard handles both).
   - Read the privacy summary.
   - Click "Open Atlas".

## The five-minute story

> Start the timer once the home screen shows.

### Beat 1 — Wake the assistant (00:00–00:10)

Press **⌘ + Shift + A** for push-to-talk (or say "Hey Atlas" if you trained a wakeword and dropped the `.onnx` into the resources directory).

*What to look for:* tray icon flips from slate to sky-blue (armed), then emerald (listening). The home screen's prompt changes to "Connecting…" then "Listening…".

### Beat 2 — General knowledge (00:10–00:25)

Say: **"What's twenty-seven times four?"**

*What to look for:* tray flips amber (thinking) for ~1s, then violet (speaking). Atlas says "One hundred eight" in the cloned voice. The caption strip at the bottom shows both halves of the turn.

This proves the round-trip: mic → Scribe v2 → Worker → Claude → Worker → Flash v2 → speaker. No tools fire.

### Beat 3 — Web search with artifact (00:25–01:10)

Say: **"What's the weather in San Francisco tomorrow?"**

*What to look for:*
- Tray flips amber (Claude decides to call `web_search`).
- Worker hits Brave, ~400ms.
- Atlas summarises in 1–3 spoken sentences.
- Bottom-of-window caption stays in sync.
- (Phase 2.1) An on-screen card appears with the source links — for the judges' build, the desktop logs the `atlas:artifact` event but the card surface lands next phase.

This proves: tools registry → Worker server-tool dispatch → result loop → spoken summary + visual artifact.

### Beat 4 — Launch an app (01:10–01:25)

Say: **"Open Safari"** (or any installed app — Atlas walks `/Applications` and `/System/Applications/Utilities` and fuzzy-matches).

*What to look for:* Safari opens. Atlas confirms in one sentence ("Opening Safari"). Conversation continues without leaving the call.

This proves: client-tool path. Worker emits OpenAI tool_call → Conv-AI forwards `client_tool_call` → desktop dispatcher → `launch_app::execute` → spawn detached.

### Beat 5 — Music control (01:25–01:45)

(Pre-condition: have Music.app or Spotify already open in the background.)

Say: **"Play"** — then a few seconds later — **"Pause"**.

*What to look for:* music starts and stops via osascript. Atlas acknowledges each verb.

This proves: macOS-native dispatch (no Spotify Web API needed for the demo); osascript bridge picks whichever music app is running.

### Beat 6 — Interruption (01:45–02:05)

Say: **"Tell me a long story about how the Beatles broke up"**, wait until Atlas starts speaking, then talk over them: **"Stop"** (or anything — the agent's VAD catches it).

*What to look for:* Atlas truncates mid-sentence. Tray flips emerald again (listening) immediately. Caption strip shows `agent_response_correction` — Atlas knows what it would have said vs what it actually got out before being cut off.

This proves: full interruption handling in the playback ring buffer + state machine.

### Beat 7 — Cap (02:05–02:20)

Open Settings (gear icon top-right) and show the **Privacy** tab. The "Delete all local data" button wipes prefs + onboarding flag and drops the user back into the wizard.

Optional finisher: click the tray menu → "Toggle mini overlay". The 320×96 always-on-top pill appears and mirrors state + last caption line.

---

## Sample fallback queries

If the demo machine refuses to cooperate, here are voice queries that work without external services and prove the loop is alive:

- "Hi" → general greeting; no tool fires.
- "Tell me a one-line haiku about rain" → general creative.
- "What can you help me with?" → meta — Atlas describes its capabilities.

## What's intentionally not in this build

- `find_files`, `open_path`, `system_action` — Phase 1.4 / 1.5; tools registry has them, dispatcher returns "not implemented on the desktop client" so the agent moves on gracefully.
- Spotify Web API search ("play Wonderwall" with a query) — Phase 1.3.x; falls back to clean "Spotify isn't connected — connect in Settings."
- Conversation memory across sessions — Phase 5+.
- Vision / camera input — Phase 3+.

## Architecture talking points

If a judge asks "how does this work":

```
mic ──cpal──► 16kHz mono PCM ──WSS──► ElevenLabs Conv-AI ◄──custom-LLM──► Cloudflare Worker ──► Claude Opus 4.7
                                              │                                  │
                                              │                                  └──server-tools──► Brave Search
                                              │
                                              └──client_tool_call──► desktop tools/dispatch ──► launch_app / music_control / render_artifact
```

- **No data warehoused.** Mic frames stream in real time; STT + TTS happen on the wire; nothing is stored beyond the active session (privacy summary on the onboarding Privacy screen).
- **Worker is the brain proxy.** Single Bearer token to ElevenLabs; rotates without redeploy. Anthropic key never leaves Cloudflare.
- **livekit-wakeword (ADR 0019)** — pure-Rust ONNX via ort-tract. Picovoice's Rust binding was removed; we found this is also a better fit (open-source, no commercial gate, by the LiveKit team who power ElevenLabs' WebRTC).
- **Two macOS-native code paths**: `launch_app` shells `open -a`; `music_control` shells `osascript` to talk to whichever of Music.app or Spotify is running. No private frameworks; no entitlements.

## After the demo

If they want to poke under the hood:

- Logs live at `~/Library/Logs/com.atlas.desktop/atlas.log`.
- Tail in real time: `tail -f ~/Library/Logs/com.atlas.desktop/atlas.log`.
- Source code: this repo. Commit history is one focused commit per phase increment with verification before each.
