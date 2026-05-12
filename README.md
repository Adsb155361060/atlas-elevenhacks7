# Atlas

Voice-first desktop AI assistant. Talk to your computer. It does anything.

Built on four ElevenLabs primitives — **Conversational Agent** (orchestration), **Scribe v2 Realtime** (STT), **Flash v2.5** (TTS), and **Instant Voice Clone** (the voice you pick) — with **Claude Opus 4.7** as the reasoning brain. Cross-platform: macOS, Linux, Windows.

> Working name. The project will rename before public launch (ADR 0001). "Atlas" is the dev-time identifier.

## Status

Pre-Phase-0 scaffold. See [`jarvis_build_plan.md`](../jarvis_build_plan.md) for the product spec and [`jarvis_dev_plan.md`](../jarvis_dev_plan.md) for the step-by-step execution plan.

## Quickstart (post-Phase-0)

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
