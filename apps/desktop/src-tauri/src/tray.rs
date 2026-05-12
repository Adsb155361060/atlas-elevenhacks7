//! System tray construction.
//!
//! Tray icon presents the conversational state at a glance and provides a
//! menu for the rare moments the user wants to interact via mouse. Left-click
//! the icon to open the main window; right-click for the menu.

use anyhow::Result;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

use crate::state::{self, AtlasState};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Atlas", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause listening", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Resume listening", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Atlas", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &pause, &resume, &settings, &separator, &quit],
    )?;

    TrayIconBuilder::with_id("main-tray")
        .tooltip("Atlas — idle")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .build(app)?;

    Ok(())
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "open" | "settings" => show_main(app),
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
        "quit" => {
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
