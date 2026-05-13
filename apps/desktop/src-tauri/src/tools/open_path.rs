//! `open_path` client tool — open a file or folder with the system default.
//!
//! macOS: `/usr/bin/open <path>`
//! Linux: `xdg-open <path>` (BSD-ish coverage; falls through if missing).
//! Windows: PowerShell `Start-Process` (not wired in V1).
//!
//! Tilde expansion is done in-process so the agent can pass `~/Downloads`
//! without thinking about shell semantics.

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
use anyhow::anyhow;
use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Runtime};

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct OpenInput {
    path: String,
}

pub fn execute<R: Runtime>(_app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: OpenInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("open_path: invalid parameters: {err}")),
    };
    let path = expand_tilde(&input.path);
    if !path.exists() {
        return ToolResult::err(format!(
            "open_path: nothing exists at '{}'",
            path.display()
        ));
    }
    match open(&path) {
        Ok(_) => ToolResult::ok(json!({ "opened": true, "path": path.display().to_string() })),
        Err(err) => ToolResult::err(format!("open_path: {err}")),
    }
}

fn expand_tilde(raw: &str) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    if raw == "~" {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home);
        }
    }
    PathBuf::from(raw)
}

#[cfg(target_os = "macos")]
fn open(path: &std::path::Path) -> Result<()> {
    Command::new("/usr/bin/open")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| format!("open {}", path.display()))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn open(path: &std::path::Path) -> Result<()> {
    Command::new("xdg-open")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| format!("xdg-open {}", path.display()))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn open(_path: &std::path::Path) -> Result<()> {
    Err(anyhow!("open_path: Windows path not wired yet"))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn open(_path: &std::path::Path) -> Result<()> {
    Err(anyhow!("open_path: unsupported platform"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_tilde_resolves_home() {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let expanded = expand_tilde("~/Downloads");
        if let Some(home) = home {
            assert_eq!(expanded, home.join("Downloads"));
        }
    }

    #[test]
    fn expand_tilde_passes_absolute() {
        assert_eq!(expand_tilde("/etc/hosts"), PathBuf::from("/etc/hosts"));
    }
}
