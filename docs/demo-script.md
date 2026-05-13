# Demo script — ElevenHacks 7

A ~3-minute walkthrough designed to exercise every ElevenLabs primitive in order, with one big "wow" moment in each beat. Optimised for video / judge takedowns.

## Pre-flight (judge runs this once)

1. Drag **Atlas.app** to `/Applications`.
2. Right-click → Open (Gatekeeper bypass; one-time).
3. Grant microphone permission at the system prompt.
4. Complete onboarding:
   - Pick a stock voice, **or** record 30 seconds of your own voice — Atlas will speak back as you.
   - Read the privacy summary.
   - Click "Open Atlas".

## The seven-beat story

> Start the timer once the home screen shows.

### Beat 1 — The handshake (00:00–00:10)

Press **⌘ + Shift + A** for push-to-talk. Say: **"Hi Atlas, what can you do?"**

**Wow moment:** the voice you hear back is *the one you just cloned*. ElevenLabs IVC + Flash v2.5 talking to you in your own voice within seconds of recording it.

*What to look for:* tray flips sky-blue (armed) → emerald (listening) → amber (thinking) → violet (speaking). Caption strip at the bottom shows the round-trip.

### Beat 2 — Generate an image (00:10–00:35)

Say: **"Generate an image of a watercolour cat astronaut on Mars."**

**Wow moment:** voice → Gemini Imagen → image on screen in 5 seconds. The agent says one short sentence ("Here's that cat astronaut") and the image appears in the artifact surface, captioned.

*What to look for:* `generate_image` server tool fires (~3s), then `render_artifact` client tool fires; the centre of the window switches from idle copy to a centred PNG with caption.

### Beat 3 — Iterate on the image (00:35–01:00)

Say: **"Make it dramatic — sunset lighting, lonelier mood."**

**Wow moment:** same artifact id, version 2 — the surface animates between versions while Atlas speaks. Iterative refinement is the hero pattern from the build plan; this is the simplest visible version.

### Beat 4 — Generate music (01:00–01:35)

Say: **"Make me a thirty-second warm lo-fi loop with vinyl crackle."**

**Wow moment:** voice → ElevenLabs Music API → 30s MP3 → embedded `<audio>` element that auto-plays. ElevenLabs's newest primitive, judging-day-fresh. Atlas says "Here's a thirty-second warm lo-fi loop" and the player appears alongside.

*What to look for:* `generate_music` server tool (~10–20s; ElevenLabs Music is the slower of the toolset). Caption shows the spoken intro before the audio plays.

### Beat 5 — Web search + spoken summary + visible sources (01:35–02:10)

Say: **"What's the weather in San Francisco tomorrow?"**

**Wow moment:** Atlas summarises in 1–3 sentences AND the source list appears below. Voice + screen in parallel. This is the differentiator vs Siri/Alexa — they speak OR show, never both at once.

*What to look for:* `web_search` server tool → Brave Search → answer plus a `render_artifact` with `type: "search_results"` showing the cards with sources.

### Beat 6 — Multilingual on the fly (02:10–02:35)

Say: **"Now switch to Spanish and tell me a joke about cats."**

**Wow moment:** Scribe v2 hears the language switch in real time. Atlas continues in Spanish — same voice, native pronunciation. Conv-AI's language_detection picks it up; the system prompt nudges Atlas to stay in the chosen language until the user switches back.

Then say: **"Back to English."** It flips immediately.

### Beat 7 — Tool grounding (02:35–03:00)

Say: **"Open Safari and play some music."**

**Wow moment:** Atlas chains two tools in a single turn — `launch_app` (Safari opens via `open -a` cross-process) and `music_control` (osascript to whichever music app is running). Safari opens; music starts. Atlas confirms in one breath.

This is the bridge between "AI that talks" and "AI that does."

### Outro (03:00 hard stop)

Optional finisher: open Settings (gear icon top-right), show the **Privacy** tab. Point at "Delete all local data" — proves the privacy promise is real, not marketing.

Then click the tray menu → "Toggle mini overlay". A 320×96 always-on-top pill appears on the desktop mirroring state + last caption. "It's voice-first but doesn't have to live in your workflow's way."

---

## ElevenLabs primitives exercised (judge scorecard)

| Primitive | Beat | What lights up |
| --- | --- | --- |
| **Conversational Agent** (custom-LLM) | every | The whole turn-taking, interruption-handling protocol. |
| **Scribe v2 Realtime** | every | 16kHz mono PCM mic → text < 250ms TTFB. |
| **Flash v2.5** | every | Spoken reply in user's cloned voice. |
| **Instant Voice Clone (IVC)** | Beat 1 | Onboarding records 30s → unique voice id → every reply uses it. |
| **Music API** | Beat 4 | Newest primitive — voice → original music. |
| **Server tools (webhook)** | Beats 2, 4, 5 | Worker proxies for Brave + Imagen + Music. |
| **Client tools (WS)** | Beats 2-7 | render_artifact, launch_app, music_control dispatched to the desktop. |
| **language_detection** | Beat 6 | Native multilingual switching. |

## Sample fallback queries

If a tool misbehaves on demo day, here are queries that work without external services and prove the loop is alive:

- "What's twenty-seven times four?" — general Q&A, no tool fires.
- "Tell me a one-line haiku about rain." — creative.
- "What can you help me with?" — meta: Atlas describes its tools.

## Architecture talking points

If a judge asks "how does this work":

```
mic ──cpal──► 16kHz mono PCM ──WSS──► ElevenLabs Conv-AI ◄──custom-LLM──► Cloudflare Worker ──► Claude Opus 4.7
                                              │                                  │
                                              │                                  └──server tools──► Brave Search
                                              │                                                     ElevenLabs Music
                                              │                                                     Gemini Imagen
                                              │
                                              └──client_tool_call──► desktop tools/dispatch ──► render_artifact
                                                                                                launch_app
                                                                                                music_control
```

- **No data warehoused.** Mic frames stream in real time; STT + TTS happen on the wire; nothing is stored beyond the active session.
- **The Worker is the brain proxy.** Single Bearer token to ElevenLabs; rotates without redeploy. Anthropic / Brave / Gemini / ElevenLabs Music keys never leave Cloudflare.
- **livekit-wakeword (ADR 0019)** — pure-Rust ONNX via ort-tract. Picovoice's Rust binding was removed; we found this is also a better fit (open-source, no commercial gate, by the LiveKit team who power ElevenLabs' WebRTC).
- **Two macOS-native code paths**: `launch_app` shells `open -a`; `music_control` shells `osascript` to talk to whichever of Music.app or Spotify is running. No private frameworks; no entitlements.
- **Voice clone persists**: the voice id you create in onboarding is saved via tauri-plugin-store and injected into every subsequent session via `conversation_config_override.tts.voice_id`. One voice across all turns.

## What's intentionally not in this build

- `find_files`, `open_path`, `system_action` — Phase 1.4 / 1.5; dispatcher returns "not implemented" so the agent moves on gracefully.
- Spotify Web API "play <song name>" — Phase 1.3.x; current build covers play/pause/next/previous via osascript.
- Conversation memory across sessions — Phase 5+.
- Vision / camera input — Phase 3+.

## After the demo

Logs live at `~/Library/Logs/com.atlas.desktop/atlas.log`. Tail in real time:

```bash
tail -f ~/Library/Logs/com.atlas.desktop/atlas.log
```

Source code is in this repo. Commit history is one focused commit per phase increment with verification before each — `git log --oneline` tells the story chronologically.
