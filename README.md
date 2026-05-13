# Atlas

Voice-first desktop AI assistant. Talk to your computer. It does anything.

Built on four ElevenLabs primitives — **Conversational Agent** (orchestration), **Scribe v2 Realtime** (STT), **Flash v2.5** (TTS), and **Instant Voice Clone** (the voice you pick) — with **Claude Opus 4.7** as the reasoning brain. Cross-platform: macOS, Linux, Windows.

> Working name. The project will rename before public launch (ADR 0001). "Atlas" is the dev-time identifier.

## For ElevenHacks 7 judges

> **Three steps to demo Atlas on your MacBook.** No compilation, no Rust toolchain. Mac (Apple Silicon or Intel) running macOS 12.3+ is all you need.

### 1. Download the bundle

Grab the latest universal `.dmg` from the [Releases page](../../releases/latest) and drag **Atlas.app** into `/Applications`.

The build is unsigned (no Apple Developer account — hackathon trade-off). First launch will trigger Gatekeeper:

```text
Right-click Atlas.app  →  Open  →  Open
```

You only need to do this once per machine. Subsequent launches open normally.

### 2. Paste your keys

Open Atlas. The first-run onboarding walks you through picking a voice. Before that flow can talk to Claude, two keys need to land in the app's config:

1. **Anthropic key** — [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys). Free $5 trial covers all demo turns.
2. **ElevenLabs key** — [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys). Free tier covers the voice loop.

Open `~/Library/Application Support/com.atlas.desktop/preferences.json` and paste the keys (or use the Settings panel in-app once you've completed onboarding).

### 3. Try these voice queries

After onboarding, click the tray icon (top-right menu bar) or press **⌘ + Shift + A** for push-to-talk. The breathing emerald dot means Atlas is listening.

| Say this | Exercises |
| --- | --- |
| *"Hey Atlas, what's the weather in San Francisco tomorrow?"* | wake-word → web_search → audio summary + visual artifact |
| *"Open Safari"* | launch_app fuzzy match across `/Applications` |
| *"Play"* | music_control via osascript → controls Music.app or Spotify if open |
| *"Pause"* | same — confirms the control round-trip |
| *"What's twenty-seven times four?"* | general Q&A — no tool, just Claude |

**What you should see:**

- The tray icon changes colour as state transitions: idle → armed → listening → thinking → speaking.
- A scrolling caption appears at the bottom of the main window showing both your transcript and Atlas's reply.
- Search queries paint a results card on screen alongside the spoken summary.

**Troubleshooting one-liners:**

- **"Atlas can't be opened because Apple cannot check it for malicious software"** — that's the Gatekeeper warning. Right-click → Open → Open. One-time.
- **Microphone permission prompt** — say yes. macOS gates this per-app.
- **No tray icon visible** — Atlas runs hidden by default. Look for the round colour-dot in your menu bar (top-right of screen, next to Wi-Fi / Battery).
- **"Hey Atlas" doesn't trigger** — wake-word recognition needs a custom `.onnx` we don't ship in the demo bundle. Use **⌘ + Shift + A** (push-to-talk) instead.

A pre-recorded 90-second walkthrough lives at [`docs/demo-script.md`](./docs/demo-script.md).

## Status

Phase 0 (voice loop + onboarding + settings) complete. Phase 1 (six voice command tools) in progress — `web_search`, `launch_app`, `music_control`, and `render_artifact` are live in this build; `find_files`, `open_path`, `system_action` land next. See [`jarvis_build_plan.md`](../jarvis_build_plan.md) for the product spec and [`jarvis_dev_plan.md`](../jarvis_dev_plan.md) for the step-by-step execution plan.

## Quickstart (developers — build from source)

```bash
# One-time setup
./scripts/setup.sh
cp .env.example .env.local && $EDITOR .env.local
direnv allow

# Daily dev loop
pnpm install
pnpm dev                 # worker + desktop in parallel
pnpm smoke               # end-to-end voice-loop smoke test
```

## Layout

```
apps/
├── desktop/            # Tauri 2 app (Rust + React)
├── worker/             # Cloudflare Worker — Claude proxy for ElevenLabs custom LLM endpoint
└── web/                # marketing site (later)
packages/
├── contracts/          # shared TS types (tool schemas, IPC messages)
├── prompts/            # versioned system prompts + tool definitions
└── sdk/                # internal SDK helpers
scripts/                # setup, smoke, latency-trace, eval helpers
docs/
├── architecture.md
├── decisions/          # ADRs (Architecture Decision Records)
├── runbooks/           # operational runbooks
└── retros/             # phase retrospectives
```

## Foundational decisions

See [`docs/decisions/`](./docs/decisions/) for the ADRs that frame everything else. Highlights:

- **Working name** — Atlas (rename before public launch; ADR 0001)
- **Lead wedge** — Accessibility-first (ADR 0002)
- **Desktop framework** — Tauri 2 (ADR 0006)
- **Primary dev OS** — Linux; cross-platform via CI (ADR 0004, 0005)
- **License** — MIT (ADR 0008)
- **Local-first** — privacy as brand moat; SQLCipher + LanceDB local (ADR 0013)

## Contributing

The build plan and dev plan describe the project's roadmap. We commit one focused commit per phase increment with a typecheck/build smoke before committing. Hooks enforce conventional commits.

## License

MIT — see [LICENSE](./LICENSE).
