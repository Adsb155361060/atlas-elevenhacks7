# `@atlas/desktop` — Tauri 2 desktop app

The user-facing Atlas application. Rust core + React webview. Cross-platform: Linux primary, macOS + Windows targets from V1 via CI matrix.

## Status

**Phase 0.C scaffold.** System tray, idle window, persistent settings store, structured logging. No audio yet — that lands in Phase 0.D (wake word) and 0.E (voice loop).

## Layout

```
src/                        # React frontend
├── components/             # presentational
├── state/                  # zustand stores (mirror Rust state)
├── ipc/                    # Tauri command wrappers
├── App.tsx
├── main.tsx
└── styles.css
src-tauri/                  # Rust backend
├── Cargo.toml
├── tauri.conf.json
├── build.rs
├── capabilities/           # capability declarations (Tauri 2 permissions)
├── icons/                  # tray + app icons
└── src/
    ├── main.rs             # bin entry; calls lib::run()
    ├── lib.rs              # tauri::Builder + plugin wiring
    ├── state.rs            # AtlasState enum + watch channel + emit
    ├── tray.rs             # system tray construction
    └── commands.rs         # #[tauri::command] surface
```

## Dev

```bash
# from repo root after pnpm install
pnpm --filter @atlas/desktop tauri:dev      # full app with hot reload
pnpm --filter @atlas/desktop dev            # frontend only (no tauri)
pnpm --filter @atlas/desktop typecheck

# Rust-only iterations
cd apps/desktop/src-tauri
cargo check
cargo clippy --no-deps -- -D warnings
cargo test
```

## Build

```bash
pnpm --filter @atlas/desktop tauri:build    # release binary + .deb + AppImage on Linux
```

Bundle outputs land at `apps/desktop/src-tauri/target/release/bundle/`.

## State machine

Rust is authoritative. The `AtlasState` enum has five variants — `Idle`, `Listening`, `Thinking`, `Speaking`, `Paused` — held in a `tokio::sync::watch` channel and exposed via:

- Tauri commands: `get_state`, `set_state` (frontend → backend).
- Tauri event: `atlas:state` (backend → frontend; payload is the lowercase variant name).

The frontend subscribes via `subscribeToState` in `src/ipc/state.ts` and mirrors the value into the zustand store.

## Persistence

`tauri-plugin-store` provides per-user JSON state at the OS-native config dir:

- Linux: `~/.config/com.atlas.desktop/`
- macOS: `~/Library/Application Support/com.atlas.desktop/`
- Windows: `%APPDATA%\com.atlas.desktop\`

Logs at the same scope under `LogDir` — see `src-tauri/src/lib.rs`.

## Why Tauri 2

ADR 0006. The short version: Rust core gives us direct access to mic (cpal), camera (nokhwa), and accessibility APIs (atspi / AXUI / UIA) without Node FFI; 10MB binary vs 100MB+ Electron; Tauri 2's plugin system handles permissioned APIs cleanly.
