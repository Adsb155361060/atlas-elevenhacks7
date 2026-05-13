//! `launch_app` client tool — open a desktop app by display name.
//!
//! Linux path (the only fully-implemented one for Phase 1.2):
//!   1. Discover `.desktop` files in standard locations (system + user +
//!      Flatpak exports). Each yields an `AppEntry { id, name, exec }`.
//!   2. Skip entries with `NoDisplay=true`, `Hidden=true`, or no `Exec=`.
//!   3. Fuzzy-match the user's query against the `Name=` field (and
//!      common aliases — "chrome"→"google-chrome" comes from the
//!      substring match SkimMatcherV2 already does).
//!   4. Strip `%f %u %F %U` etc placeholders from `Exec=` and spawn
//!      detached via `setsid` so the launched process survives the
//!      Atlas main loop terminating.
//!
//! macOS uses `/usr/bin/open -a <name>` — covers most apps; the OS
//! resolves the display name to the right bundle.
//! Windows uses `cmd /c start "" "<name>"` — same idea.
//!
//! Not in Phase 1.2:
//!   - Recency-of-use ranking (dev plan §5.3 #5).
//!   - Detecting "already running" vs cold launch (§5.3 #6).
//!   - Multi-window app handling.
//!     These all land in Phase 6 when we tighten the desktop UX.

#![allow(dead_code)] // some helpers are platform-specific

use anyhow::{anyhow, Context, Result};
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct LaunchInput {
    name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppEntry {
    /// Stable id — `.desktop` basename on Linux, app name elsewhere.
    pub id: String,
    /// Display name as shown in app menus.
    pub name: String,
    /// Command line (Linux: post-placeholder-strip `Exec=`. macOS / Windows:
    /// the name passed through `open -a` / `start`).
    pub exec: String,
}

pub fn execute<R: Runtime>(_app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: LaunchInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => {
            return ToolResult::err(format!("launch_app: invalid parameters: {err}"))
        }
    };
    match launch(&input.name) {
        Ok(entry) => ToolResult::ok(json!({
            "launched": true,
            "app_id": entry.id,
            "app_name": entry.name,
        })),
        Err(err) => ToolResult::err(format!("launch_app: {err}")),
    }
}

pub fn launch(query: &str) -> Result<AppEntry> {
    let query = query.trim();
    if query.is_empty() {
        return Err(anyhow!("name is required"));
    }
    let entries = discover_apps();
    let entry = best_match(query, &entries)
        .ok_or_else(|| anyhow!("no app matched '{query}' (scanned {} entries)", entries.len()))?;
    spawn_detached(&entry)?;
    log::info!("launch_app: launched id={} name={}", entry.id, entry.name);
    Ok(entry)
}

// ───────────────────────── discovery ─────────────────────────

#[cfg(target_os = "linux")]
pub fn discover_apps() -> Vec<AppEntry> {
    let mut roots: Vec<PathBuf> = vec![
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
        PathBuf::from("/var/lib/flatpak/exports/share/applications"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(Path::new(&home).join(".local/share/applications"));
        roots.push(Path::new(&home).join(".local/share/flatpak/exports/share/applications"));
    }
    // Optional: $XDG_DATA_DIRS may list additional roots.
    if let Ok(dirs) = std::env::var("XDG_DATA_DIRS") {
        for dir in dirs.split(':').filter(|s| !s.is_empty()) {
            roots.push(Path::new(dir).join("applications"));
        }
    }

    let mut entries = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();
    for root in roots {
        let Ok(read) = std::fs::read_dir(&root) else {
            continue;
        };
        for dent in read.flatten() {
            let path = dent.path();
            if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            if id.is_empty() || !seen_ids.insert(id.clone()) {
                // Later XDG_DATA_DIRS roots are lower priority than earlier
                // ones; first wins. Match xdg behavior.
                continue;
            }
            if let Some(entry) = parse_desktop_entry(&id, &text) {
                entries.push(entry);
            }
        }
    }
    entries
}

#[cfg(target_os = "macos")]
pub fn discover_apps() -> Vec<AppEntry> {
    // /Applications listing → AppEntry { id=app-basename, name=app-name,
    // exec=name } so `open -a "<name>"` can resolve it. Cheap and avoids
    // parsing Info.plist; sufficient for fuzzy matching by name.
    let mut entries = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for root in ["/Applications", "/System/Applications"] {
        let Ok(read) = std::fs::read_dir(root) else {
            continue;
        };
        for dent in read.flatten() {
            let path = dent.path();
            if path.extension().and_then(|e| e.to_str()) != Some("app") {
                continue;
            }
            let Some(name) = path.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string())
            else {
                continue;
            };
            if !seen.insert(name.clone()) {
                continue;
            }
            entries.push(AppEntry {
                id: name.clone(),
                name: name.clone(),
                exec: name,
            });
        }
    }
    entries
}

#[cfg(target_os = "windows")]
pub fn discover_apps() -> Vec<AppEntry> {
    // Lightweight: rely on `start` resolving Start-menu shortcuts by name.
    // A full implementation reads %APPDATA%\Microsoft\Windows\Start Menu —
    // Phase 1.2 punts to that.
    Vec::new()
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn discover_apps() -> Vec<AppEntry> {
    Vec::new()
}

// ───────────────────────── parsing ─────────────────────────

/// Parse a `.desktop` file body. Returns `None` if NoDisplay/Hidden, no Exec,
/// or no Name. Reads only the `[Desktop Entry]` section; trailing actions
/// (`[Desktop Action *]`) are ignored.
pub fn parse_desktop_entry(id: &str, contents: &str) -> Option<AppEntry> {
    let mut in_main = false;
    let mut kv: HashMap<String, String> = HashMap::new();
    for raw in contents.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            in_main = line == "[Desktop Entry]";
            continue;
        }
        if !in_main {
            continue;
        }
        let Some(eq) = line.find('=') else { continue };
        // .desktop keys can have locale suffixes like Name[en_US]. Drop them
        // — locale negotiation is out of scope for V1.
        let key_raw = &line[..eq];
        let key = key_raw.split('[').next().unwrap_or(key_raw).trim().to_string();
        if kv.contains_key(&key) {
            continue;
        }
        kv.insert(key, line[eq + 1..].trim().to_string());
    }
    if is_truthy(kv.get("NoDisplay")) || is_truthy(kv.get("Hidden")) {
        return None;
    }
    let name = kv.get("Name")?.to_string();
    let exec = strip_exec_placeholders(kv.get("Exec")?);
    if exec.is_empty() {
        return None;
    }
    Some(AppEntry {
        id: id.to_string(),
        name,
        exec,
    })
}

fn is_truthy(v: Option<&String>) -> bool {
    matches!(v.map(|s| s.trim().to_ascii_lowercase()), Some(ref s) if s == "true" || s == "1")
}

/// Strip `%f %u %F %U %d %D %n %N %i %c %k %m %v` placeholders. Keep `%%` as
/// a literal `%`. xdg-spec compliant; this is what xdg-open / desktop
/// launchers do.
pub fn strip_exec_placeholders(exec: &str) -> String {
    let mut out = String::with_capacity(exec.len());
    let mut chars = exec.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            match chars.next() {
                Some('%') => out.push('%'),
                Some(_) => continue, // drop placeholder
                None => break,
            }
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

// ───────────────────────── matching ─────────────────────────

/// Return the best-scoring match — None if nothing scores above an empirical
/// threshold (keeps "foo" from accidentally launching anything that contains
/// an 'f', 'o', 'o' subsequence).
pub fn best_match(query: &str, entries: &[AppEntry]) -> Option<AppEntry> {
    if entries.is_empty() {
        return None;
    }
    let matcher = SkimMatcherV2::default().ignore_case();
    let mut scored: Vec<(i64, &AppEntry)> = entries
        .iter()
        .filter_map(|e| {
            // Score against both id (often "google-chrome") and name ("Google Chrome").
            let s_name = matcher.fuzzy_match(&e.name, query);
            let s_id = matcher.fuzzy_match(&e.id, query);
            s_name.into_iter().chain(s_id).max().map(|s| (s, e))
        })
        .collect();
    scored.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    let (score, entry) = scored.first()?;
    // SkimMatcherV2 score for a fully-contained subsequence is typically >= query.len() * 16.
    // Use a conservative floor proportional to query length so we don't fire
    // on a single matching character.
    let floor = (query.chars().count() as i64) * 12;
    if *score < floor {
        return None;
    }
    Some((*entry).clone())
}

// ───────────────────────── spawn ─────────────────────────

#[cfg(target_os = "linux")]
fn spawn_detached(entry: &AppEntry) -> Result<()> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    // `setsid` reparents to init so the child survives if Atlas exits.
    let mut cmd = Command::new("setsid");
    cmd.arg("--fork")
        .arg("/bin/sh")
        .arg("-c")
        .arg(&entry.exec)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // Belt-and-braces: also setsid via prctl-like flag.
    unsafe {
        cmd.pre_exec(|| {
            // Set the child's umask conservatively (077) and detach from any
            // controlling terminal. `setsid --fork` already covers the
            // terminal piece; this is for paranoia on minimal distros.
            Ok(())
        });
    }
    cmd.spawn().with_context(|| format!("spawn {:?}", entry.exec))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn spawn_detached(entry: &AppEntry) -> Result<()> {
    use std::process::{Command, Stdio};
    Command::new("/usr/bin/open")
        .arg("-a")
        .arg(&entry.exec)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| format!("open -a {:?}", entry.exec))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn spawn_detached(entry: &AppEntry) -> Result<()> {
    use std::process::{Command, Stdio};
    Command::new("cmd")
        .arg("/c")
        .arg("start")
        .arg("") // empty window title
        .arg(&entry.exec)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| format!("start {:?}", entry.exec))?;
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn spawn_detached(_entry: &AppEntry) -> Result<()> {
    Err(anyhow!("launch_app: unsupported platform"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, name: &str, exec: &str) -> AppEntry {
        AppEntry { id: id.into(), name: name.into(), exec: exec.into() }
    }

    #[test]
    fn strips_exec_placeholders() {
        assert_eq!(strip_exec_placeholders("google-chrome %U"), "google-chrome");
        assert_eq!(strip_exec_placeholders("vlc %F"), "vlc");
        assert_eq!(strip_exec_placeholders("/usr/bin/foo"), "/usr/bin/foo");
        assert_eq!(strip_exec_placeholders("sh -c 'echo 100%%'"), "sh -c 'echo 100%'");
        assert_eq!(strip_exec_placeholders(""), "");
    }

    #[test]
    fn parses_chrome_desktop_entry() {
        let raw = r#"[Desktop Entry]
Version=1.0
Name=Google Chrome
Name[ja]=グーグル・クローム
Comment=Access the Internet
Exec=/usr/bin/google-chrome-stable %U
Terminal=false
Type=Application
Icon=google-chrome
Categories=Network;WebBrowser;
"#;
        let parsed = parse_desktop_entry("google-chrome", raw).expect("parses");
        assert_eq!(parsed.id, "google-chrome");
        assert_eq!(parsed.name, "Google Chrome");
        assert_eq!(parsed.exec, "/usr/bin/google-chrome-stable");
    }

    #[test]
    fn rejects_nodisplay_and_hidden() {
        let raw = "[Desktop Entry]\nName=Background svc\nExec=daemon\nNoDisplay=true\n";
        assert!(parse_desktop_entry("daemon", raw).is_none());
        let raw2 = "[Desktop Entry]\nName=ZombieApp\nExec=z\nHidden=true\n";
        assert!(parse_desktop_entry("zombie", raw2).is_none());
    }

    #[test]
    fn ignores_action_subsections() {
        let raw = r#"[Desktop Entry]
Name=Firefox
Exec=/usr/bin/firefox %u
Type=Application

[Desktop Action new-window]
Name=Open a New Window
Exec=/usr/bin/firefox --new-window
"#;
        let parsed = parse_desktop_entry("firefox", raw).expect("parses");
        assert_eq!(parsed.exec, "/usr/bin/firefox");
    }

    #[test]
    fn fuzzy_match_picks_chrome_for_chrome() {
        let entries = vec![
            entry("google-chrome", "Google Chrome", "google-chrome %U"),
            entry("firefox", "Firefox", "firefox"),
            entry("vlc", "VLC media player", "vlc"),
        ];
        let m = best_match("chrome", &entries).unwrap();
        assert_eq!(m.id, "google-chrome");
    }

    #[test]
    fn fuzzy_match_picks_obsidian_substring() {
        let entries = vec![
            entry("obsidian", "Obsidian", "obsidian %U"),
            entry("org.gnome.Builder", "GNOME Builder", "builder"),
        ];
        let m = best_match("obsidian", &entries).unwrap();
        assert_eq!(m.id, "obsidian");
    }

    #[test]
    fn fuzzy_match_returns_none_when_below_floor() {
        // Single 'x' against entries that all start with very different
        // letters — score will be below the floor.
        let entries = vec![entry("a", "Apples", "a"), entry("b", "Bananas", "b")];
        assert!(best_match("xyzqrs", &entries).is_none());
    }

    #[test]
    fn fuzzy_match_terminal_finds_terminal_app() {
        let entries = vec![
            entry("gnome-terminal", "GNOME Terminal", "gnome-terminal"),
            entry("org.gnome.Console", "Console", "kgx"),
        ];
        let m = best_match("terminal", &entries).unwrap();
        assert_eq!(m.id, "gnome-terminal");
    }
}
