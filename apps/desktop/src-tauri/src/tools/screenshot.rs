//! `screenshot` — capture the screen to a PNG file on disk.
//!
//! Reuses `vision_qa::capture_screen` (the same per-OS capture the vision
//! tool uses) and writes the bytes to `~/Pictures/atlas-screenshot-<ts>.png`,
//! falling back to the home dir or the temp dir. Returns the saved path so
//! the agent can tell the user where it landed.

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

use super::{vision_qa, ToolResult};

pub fn execute<R: Runtime>(_app: &AppHandle<R>, _parameters: &Value) -> ToolResult {
    match capture_to_file() {
        Ok(path) => ToolResult::ok(json!({ "saved": true, "path": path })),
        Err(err) => ToolResult::err(format!("screenshot: {err:#}")),
    }
}

fn capture_to_file() -> Result<String> {
    let png = vision_qa::capture_screen().context("capture screen")?;
    if png.is_empty() {
        return Err(anyhow!("screen capture produced no bytes"));
    }
    let dir = screenshot_dir();
    std::fs::create_dir_all(&dir).ok();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = dir.join(format!("atlas-screenshot-{ts}.png"));
    std::fs::write(&path, &png).with_context(|| format!("write {}", path.display()))?;
    log::info!("screenshot: saved {} ({} bytes)", path.display(), png.len());
    Ok(path.to_string_lossy().to_string())
}

/// `~/Pictures` when it exists, else the home dir, else the temp dir.
fn screenshot_dir() -> PathBuf {
    if let Some(home) = home_dir() {
        let pics = home.join("Pictures");
        if pics.is_dir() {
            return pics;
        }
        return home;
    }
    std::env::temp_dir()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}
