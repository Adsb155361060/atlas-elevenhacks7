//! Global push-to-talk hotkey.
//!
//! Registers `CommandOrControl+Shift+A` (Tauri auto-maps `CommandOrControl`
//! to ⌘ on macOS / Ctrl on Linux + Windows). On a key-down event we fire the
//! same `wake:fired` flow the wake-word module uses, so the voice loop starts
//! a session regardless of whether the on-device wake detector is configured.
//!
//! Future Phase 0.H settings panel will let users rebind this shortcut.

use anyhow::{Context, Result};
use tauri::{AppHandle, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Default keybinding. `CommandOrControl` is a Tauri pseudo-modifier that
/// resolves to ⌘ on macOS and Ctrl elsewhere — gives us one binding that
/// feels native cross-platform.
pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+A";

pub fn register<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let shortcut_app = app.clone();
    app.global_shortcut()
        .on_shortcut(DEFAULT_SHORTCUT, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                log::info!("hotkey: {DEFAULT_SHORTCUT} → push-to-talk");
                crate::wake::fire_wake_externally(&shortcut_app);
            }
        })
        .with_context(|| format!("register {DEFAULT_SHORTCUT}"))?;
    log::info!("hotkey: registered {DEFAULT_SHORTCUT}");
    Ok(())
}
