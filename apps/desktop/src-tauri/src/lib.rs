//! Atlas desktop — Tauri 2 application crate.
//!
//! `main.rs` is a thin shim; almost everything lives here so we can be
//! exercised by `cargo test` without spawning a window.

mod commands;
mod state;
mod tray;

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
        .setup(|app| {
            // Install the AtlasState watch channel into managed state.
            state::init(app.handle().clone())
                .context("state::init")
                .map_err(boxed)?;

            // Build the system tray (icon + menu + click handler).
            tray::build(app.handle())
                .context("tray::build")
                .map_err(boxed)?;

            // Window starts hidden — surfaces on tray click or wake event.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
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
        ])
        .run(tauri::generate_context!())
        .map_err(anyhow::Error::from)
        .context("tauri::Builder.run")?;
    Ok(())
}

fn boxed(err: anyhow::Error) -> Box<dyn std::error::Error> {
    Box::<dyn std::error::Error>::from(err.to_string())
}
