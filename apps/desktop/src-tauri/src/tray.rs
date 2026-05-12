//! System tray construction.
//!
//! Tray icon presents the conversational state at a glance and provides a
//! menu for the rare moments the user wants to interact via mouse. Left-click
//! the icon to open the main window; right-click for the menu.
//!
//! The icon hot-swaps when `AtlasState` changes — a tokio task subscribes to
//! the state watch channel and rewrites `set_icon` + `set_tooltip` per state.

use anyhow::Result;
use tauri::{
    image::Image,
    include_image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

use crate::state::{self, AtlasState, StateChannel};

pub const TRAY_ID: &str = "main-tray";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Atlas", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause listening", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Resume listening", true, None::<&str>)?;
    let mini = MenuItem::with_id(app, "mini", "Toggle mini overlay", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Atlas", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &pause, &resume, &mini, &settings, &separator, &quit],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(tooltip_for(AtlasState::Idle))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .build(app)?;

    spawn_state_watcher(app);
    Ok(())
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    use tauri::Emitter;
    match event.id.as_ref() {
        "open" => show_main(app),
        "settings" => {
            show_main(app);
            // Route the main window to the settings view. The frontend
            // listens for `settings:open` and flips its view state.
            let _ = app.emit("settings:open", ());
        }
        "pause" => {
            if let Err(err) = state::set(app, AtlasState::Paused) {
                log::warn!("failed to set paused: {err:#}");
            }
        }
        "resume" => {
            if let Err(err) = state::set(app, AtlasState::Idle) {
                log::warn!("failed to resume: {err:#}");
            }
        }
        "mini" => {
            if let Err(err) = crate::mini::toggle(app) {
                log::warn!("mini toggle failed: {err:#}");
            }
        }
        "quit" => {
            // Phase 0.G keeps the quit path simple: log a warning if there's
            // an in-flight voice session and exit anyway. The Phase 0.H
            // settings panel will add a proper confirmation dialog.
            if let Some(voice) = app.try_state::<crate::voice::VoiceHandle>() {
                if voice.active_session_tx.lock().is_some() {
                    log::warn!("quit: voice session active — exiting anyway");
                }
            }
            log::info!("quit from tray");
            app.exit(0);
        }
        other => log::debug!("ignored tray menu event: {other}"),
    }
}

fn handle_tray_event<R: Runtime>(tray: &tauri::tray::TrayIcon<R>, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        show_main(tray.app_handle());
    }
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// ───────────────────────── state → icon ─────────────────────────

fn icon_for(state: AtlasState) -> Image<'static> {
    // `include_image!` resolves paths relative to the crate root (src-tauri/),
    // not the source file. So we drop the `..` prefix used by `include_bytes!`.
    match state {
        AtlasState::Idle => include_image!("icons/tray-idle.png"),
        // Armed visually equals Listening — the wake just fired; treat both as
        // "active" so the user sees an immediate response on wake.
        AtlasState::Armed | AtlasState::Listening => {
            include_image!("icons/tray-listening.png")
        }
        AtlasState::Thinking => include_image!("icons/tray-thinking.png"),
        AtlasState::Speaking => include_image!("icons/tray-speaking.png"),
        AtlasState::Paused => include_image!("icons/tray-paused.png"),
    }
}

fn tooltip_for(state: AtlasState) -> String {
    match state {
        AtlasState::Idle => "Atlas — idle".into(),
        AtlasState::Armed => "Atlas — armed".into(),
        AtlasState::Listening => "Atlas — listening".into(),
        AtlasState::Thinking => "Atlas — thinking".into(),
        AtlasState::Speaking => "Atlas — speaking".into(),
        AtlasState::Paused => "Atlas — paused".into(),
    }
}

fn apply_state<R: Runtime>(app: &AppHandle<R>, state: AtlasState) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Err(err) = tray.set_icon(Some(icon_for(state))) {
        log::warn!("tray set_icon failed: {err}");
    }
    if let Err(err) = tray.set_tooltip(Some(tooltip_for(state))) {
        log::warn!("tray set_tooltip failed: {err}");
    }
}

fn spawn_state_watcher<R: Runtime>(app: &AppHandle<R>) {
    let channel = app.state::<StateChannel>();
    let mut rx = channel.rx.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let state = *rx.borrow();
            apply_state(&app, state);
            if rx.changed().await.is_err() {
                break;
            }
        }
        log::debug!("tray state watcher exited");
    });
}
