//! Tauri command surface exposed to the React frontend.
//!
//! Keep these thin — actual logic lives in the backend modules.

use crate::state::{self, AtlasState};
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub fn get_state<R: Runtime>(app: AppHandle<R>) -> String {
    state::current(&app).as_str().to_string()
}

#[tauri::command]
pub fn set_state<R: Runtime>(app: AppHandle<R>, value: String) -> Result<(), String> {
    let parsed = AtlasState::parse(&value)
        .ok_or_else(|| format!("unknown atlas state: {value:?}"))?;
    state::set(&app, parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_main_window<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn hide_main_window<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn quit_app<R: Runtime>(app: AppHandle<R>) {
    log::info!("quit_app invoked from frontend");
    app.exit(0);
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
