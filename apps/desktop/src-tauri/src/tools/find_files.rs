//! `find_files` client tool — filename search, scope-gated.
//!
//! macOS: `mdfind` (Spotlight) — fastest path, supports the scope param.
//! Linux: `find` walking the scope root.
//! Windows: deferred (Phase 1.4+).
//!
//! Filename-only for V1. Content search lands in Phase 7 with a Tantivy index.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Runtime};

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct FindInput {
    query: String,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    limit: Option<u32>,
}

pub fn execute<R: Runtime>(_app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: FindInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("find_files: invalid parameters: {err}")),
    };
    let scope = resolve_scope(input.scope.as_deref().unwrap_or("home"));
    let Some(root) = scope else {
        return ToolResult::err(format!(
            "find_files: unknown scope '{}' (use home/downloads/documents)",
            input.scope.unwrap_or_default()
        ));
    };
    let limit = input.limit.unwrap_or(10).clamp(1, 50) as usize;
    match find(&input.query, &root, limit) {
        Ok(paths) => ToolResult::ok(json!({ "paths": paths })),
        Err(err) => ToolResult::err(format!("find_files: {err}")),
    }
}

fn resolve_scope(name: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    match name {
        "home" => Some(home),
        "downloads" => Some(home.join("Downloads")),
        "documents" => Some(home.join("Documents")),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn find(query: &str, root: &std::path::Path, limit: usize) -> Result<Vec<String>> {
    // mdfind with -onlyin scopes the search; kMDItemDisplayName matches the
    // user-visible filename (handles localised names better than the raw
    // POSIX filename).
    let output = Command::new("/usr/bin/mdfind")
        .arg("-onlyin")
        .arg(root)
        .arg(format!(
            "kMDItemDisplayName == \"*{q}*\"c",
            q = escape_mdfind(query)
        ))
        .output()
        .context("invoke mdfind")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("mdfind exited {}: {stderr}", output.status));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut out = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        out.push(trimmed.to_string());
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

#[cfg(target_os = "linux")]
fn find(query: &str, root: &std::path::Path, limit: usize) -> Result<Vec<String>> {
    let pattern = format!("*{}*", query);
    let output = Command::new("find")
        .arg(root)
        .arg("-maxdepth")
        .arg("6")
        .arg("-type")
        .arg("f")
        .arg("-iname")
        .arg(&pattern)
        .output()
        .context("invoke find")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("find exited {}: {stderr}", output.status));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut out = Vec::new();
    for line in text.lines().take(limit) {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            out.push(trimmed.to_string());
        }
    }
    Ok(out)
}

#[cfg(target_os = "windows")]
fn find(_query: &str, _root: &std::path::Path, _limit: usize) -> Result<Vec<String>> {
    Err(anyhow!("find_files: Windows path not wired yet"))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn find(_query: &str, _root: &std::path::Path, _limit: usize) -> Result<Vec<String>> {
    Err(anyhow!("find_files: unsupported platform"))
}

#[cfg(target_os = "macos")]
fn escape_mdfind(query: &str) -> String {
    // mdfind metadata queries use NSPredicate-style strings. Wrapped in `*…*`
    // for substring + the `c` modifier for case-insensitive. Escape only
    // backslashes and double quotes — the rest is fine.
    query.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_scope_known_values() {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            assert_eq!(resolve_scope("home"), Some(home.clone()));
            assert_eq!(resolve_scope("downloads"), Some(home.join("Downloads")));
            assert_eq!(resolve_scope("documents"), Some(home.join("Documents")));
        }
        assert_eq!(resolve_scope("nonsense"), None);
    }
}
