# Atlas

Voice-first desktop AI assistant. Talk to your computer. It does anything.

Built on four ElevenLabs primitives — **Conversational Agent** (orchestration), **Scribe v2 Realtime** (STT), **Flash v2.5** (TTS), and **Instant Voice Clone** (the voice you pick) — with **Claude Opus 4.7** as the reasoning brain. Cross-platform: macOS, Linux, Windows.

> Working name. The project will rename before public launch (ADR 0001). "Atlas" is the dev-time identifier.

## Quick start

> **Three steps to try Atlas.** No compilation, no Rust toolchain — just the prebuilt bundle.

### 1. Download the bundle

Grab the latest installer from the [Releases page](../../releases/latest):

- **macOS** (Apple Silicon or Intel, macOS 12.3+) — `Atlas_0.0.1_universal.dmg`
- **Windows** (10 / 11, x64) — `Atlas_0.0.1_x64-setup.exe` or the `.msi`

Both builds are unsigned (no Apple Developer / EV cert — early-release trade-off). First launch:

```text
macOS    Right-click Atlas.app  →  Open  →  Open
Windows  SmartScreen → More info → Run anyway
```

You only need to do this once per machine.

### 2. Run it

That's it — no setup. The bundle ships with a working ElevenLabs agent + a rate-limited Cloudflare worker baked in, so the voice loop works on first launch. You'll see the onboarding wizard (pick a voice, read the privacy note) and then the home screen.

Daily fair-use cap per IP is **200 requests** (~30–60 demo turns depending on whether you're using web search, image generation, or just chat).

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
