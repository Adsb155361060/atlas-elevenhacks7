//! Atlas desktop — Tauri 2 application crate.
//!
//! `main.rs` is a thin shim; almost everything lives here so we can be
//! exercised by `cargo test` without spawning a window.

mod bundled;
mod commands;
mod hotkey;
mod mini;
mod state;
mod tools;
mod tray;
mod voice;
mod wake;

use anyhow::{Context, Result};
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

/// Public entry point invoked by `main.rs`. Logs the fatal error and exits
/// non-zero rather than panicking the whole webview process.
pub fn run() {
    if let Err(err) = run_inner() {
        eprintln!("atlas-desktop fatal: {err:#}");
        std::process::exit(1);
    }
}

fn run_inner() -> Result<()> {
    // Path A (judges build): if CI baked any of the four runtime config
    // values into the binary, copy them into std::env *before* any voice
    // subsystem reads its env. Idempotent — `.env.local` always wins.
    bundled::hydrate_env_from_baked();
    if bundled::baked() {
        eprintln!("atlas-desktop: running with pre-baked configuration");
    }

    tauri::Builder::default()
        // Logging — stdout + per-user OS log dir
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("atlas".into()),
                    }),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        // Persistent JSON store — settings, voice id, etc.
        .plugin(tauri_plugin_store::Builder::new().build())
        // Shell open() for "Open file location" type actions
        .plugin(tauri_plugin_shell::init())
        // Scoped filesystem access (capability-gated)
        .plugin(tauri_plugin_fs::init())
        // Platform / OS metadata
        .plugin(tauri_plugin_os::init())
        // Global hotkey (registered in Phase 0.G)
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Clipboard + notifications for the Batch-2 utility tools
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Install the AtlasState watch channel into managed state.
            state::init(app.handle().clone())
                .context("state::init")
                .map_err(boxed)?;

            // Build the system tray (icon + menu + click handler).
            tray::build(app.handle())
                .context("tray::build")
                .map_err(boxed)?;

            // Main window starts visible (declared in tauri.conf.json) so
            // first-launch users on Windows — where the system tray hides
            // behind the ^ overflow arrow — actually see the app. Mini
            // overlay stays hidden; tray menu's "Toggle mini overlay"
            // brings it up.
            if let Some(window) = app.get_webview_window(mini::MINI_LABEL) {
                let _ = window.hide();
            }

            // Global push-to-talk hotkey (Phase 0.G). Same effect as the wake
            // word: fires the wake:fired event + transitions state. Works
            // when the on-device wake detector is missing/paused.
            if let Err(err) = hotkey::register(app.handle()) {
                log::error!("hotkey: registration failed: {err:#}");
            }

            // Wake-word detection (Phase 0.D). Graceful: logs a warning and
            // continues if the wakeword model file isn't configured.
            match wake::start_if_configured(app.handle()) {
                Ok(Some(handle)) => {
                    app.manage(handle);
                    log::info!("wake: detection active");
                }
                Ok(None) => {} // already logged inside
                Err(err) => log::error!("wake init failed: {err:#}"),
            }

            // Voice loop (Phase 0.E). Graceful: logs a warning and continues
            // when ATLAS_AGENT_ID is missing. Subscribes to `wake:fired` and
            // starts one ElevenLabs Conv-AI WebSocket session per wake.
            match voice::start_if_configured(app.handle()) {
                Ok(Some(handle)) => {
                    app.manage(handle);
                    voice::spawn_pause_watcher(app.handle());
                    log::info!("voice: loop active");
                }
                Ok(None) => {} // already logged inside
                Err(err) => log::error!("voice init failed: {err:#}"),
            }

            log::info!("atlas-desktop started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::set_state,
            commands::open_main_window,
            commands::hide_main_window,
            commands::quit_app,
            commands::app_version,
            commands::open_mic_settings,
            commands::copy_diagnostics,
            commands::voice_prefs_get,
            commands::voice_prefs_set,
            commands::voice_prefs_reset,
            commands::voice_onboarding_complete,
            commands::voice_list_stock,
            commands::voice_record_and_clone,
            commands::voice_upload_and_clone,
            commands::toggle_mini_window,
            commands::vision_camera_deliver,
            commands::app_info,
            commands::settings_reset_all_data,
            commands::fire_wake_test,
            #[cfg(debug_assertions)]
            commands::send_user_message_test,
        ])
        .run(tauri::generate_context!())
        .map_err(anyhow::Error::from)
        .context("tauri::Builder.run")?;
    Ok(())
}

fn boxed(err: anyhow::Error) -> Box<dyn std::error::Error> {
    Box::<dyn std::error::Error>::from(err.to_string())
}
