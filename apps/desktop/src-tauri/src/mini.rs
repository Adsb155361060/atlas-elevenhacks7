//! Mini overlay window — a small always-on-top pill that mirrors `AtlasState`
//! and the latest caption line. Declared statically in `tauri.conf.json`
//! (label="mini"); this module only deals with show/hide/toggle.

use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime};

pub const MINI_LABEL: &str = "mini";

pub fn show<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    if let Some(window) = app.get_webview_window(MINI_LABEL) {
        window.show()?;
        window.set_always_on_top(true)?;
        let _ = window.set_focus(); // best-effort; some compositors deny
        log::debug!("mini: shown");
    } else {
        log::warn!("mini: window not found (check tauri.conf.json)");
    }
    Ok(())
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    if let Some(window) = app.get_webview_window(MINI_LABEL) {
        window.hide()?;
        log::debug!("mini: hidden");
    }
    Ok(())
}

pub fn is_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window(MINI_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

pub fn toggle<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    if is_visible(app) {
        hide(app)
    } else {
        show(app)
    }
}
