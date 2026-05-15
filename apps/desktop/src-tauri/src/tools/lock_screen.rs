//! `lock_screen` — lock the workstation immediately.
//!
//! Linux  → `loginctl lock-session`, falling back to `xdg-screensaver` /
//!          `gnome-screensaver-command`.
//! macOS  → the CGSession `-suspend` call (locks regardless of energy prefs).
//! Windows → `rundll32 user32.dll,LockWorkStation`.

use anyhow::{anyhow, Result};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use anyhow::Context;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

use super::ToolResult;

pub fn execute<R: Runtime>(_app: &AppHandle<R>, _parameters: &Value) -> ToolResult {
    match lock() {
        Ok(()) => ToolResult::ok(json!({ "locked": true })),
        Err(err) => ToolResult::err(format!("lock_screen: {err:#}")),
    }
}

#[cfg(target_os = "linux")]
fn lock() -> Result<()> {
    use std::process::Command;
    // Different desktops expose different lockers; try the common ones in order.
    let candidates = [
        "loginctl lock-session",
        "xdg-screensaver lock",
        "gnome-screensaver-command -l",
        "dm-tool lock",
    ];
    for cmd in candidates {
        let ok = Command::new("/bin/sh")
            .arg("-c")
            .arg(cmd)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Ok(());
        }
    }
    Err(anyhow!(
        "no working screen locker (tried loginctl, xdg-screensaver, gnome-screensaver, dm-tool)"
    ))
}

#[cfg(target_os = "macos")]
fn lock() -> Result<()> {
    use std::process::Command;
    let cgsession = "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession";
    let status = Command::new(cgsession)
        .arg("-suspend")
        .status()
        .context("CGSession -suspend")?;
    if status.success() {
        return Ok(());
    }
    // Fallback: sleeping the display locks when "require password" is set.
    Command::new("/usr/bin/pmset")
        .arg("displaysleepnow")
        .status()
        .context("pmset displaysleepnow")?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn lock() -> Result<()> {
    use std::process::Command;
    let status = Command::new("rundll32.exe")
        .arg("user32.dll,LockWorkStation")
        .status()
        .context("rundll32 LockWorkStation")?;
    if !status.success() {
        return Err(anyhow!("LockWorkStation exited {}", status));
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn lock() -> Result<()> {
    Err(anyhow!("lock_screen: unsupported platform"))
}
