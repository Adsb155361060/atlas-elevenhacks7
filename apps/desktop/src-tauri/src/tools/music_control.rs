//! `music_control` client tool — play/pause/skip/volume via MPRIS (Linux).
//!
//! Two layers per the dev plan §5.4:
//!   - OS-level media control (MPRIS on Linux, MediaRemote on macOS, SMTC on
//!     Windows). Phase 1.3 ships Linux fully; macOS + Windows return a clean
//!     "not implemented on this platform" so the agent doesn't pretend it
//!     worked.
//!   - Spotify Web API for "play <track/artist/playlist>" queries — needs
//!     OAuth PKCE + token cache. Phase 1.3.x will wire this; for now any
//!     call with `query` returns is_error so the agent fails gracefully
//!     and the user gets a clear "connect Spotify in Settings" message.
//!
//! MPRIS finds active players over DBus and dispatches to the first one
//! whose `PlaybackStatus` is `Playing` (else the first one at all). That
//! covers the common case where the user has a single player open.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct MusicInput {
    action: Action,
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    value: Option<f64>,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Action {
    Play,
    Pause,
    Next,
    Previous,
    Volume,
}

pub fn execute<R: Runtime>(_app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: MusicInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => {
            return ToolResult::err(format!("music_control: invalid parameters: {err}"))
        }
    };

    // A query implies "play something specific" — needs a search engine
    // (Spotify), not just MPRIS. Until Phase 1.3.x wires Spotify OAuth,
    // surface a clear, agent-friendly failure.
    if input.query.is_some() && input.action == Action::Play {
        return ToolResult::err(
            "music_control: searching for a specific track needs Spotify, which isn't connected yet — \
             tell the user to connect Spotify in Settings (lands in Phase 1.3.x)."
                .to_string(),
        );
    }

    match dispatch(&input) {
        Ok(status) => ToolResult::ok(json!({ "status": status })),
        Err(err) => ToolResult::err(format!("music_control: {err}")),
    }
}

// ───────────────────────── Linux (MPRIS) ─────────────────────────

#[cfg(target_os = "linux")]
fn dispatch(input: &MusicInput) -> Result<String> {
    use mpris::{PlaybackStatus, PlayerFinder};

    let finder = PlayerFinder::new().context("PlayerFinder::new")?;
    let players = finder.find_all().context("find_all players")?;
    if players.is_empty() {
        return Err(anyhow!("no MPRIS-capable players are running"));
    }
    // Prefer a currently-playing player; else the first one we see.
    let player = players
        .iter()
        .find(|p| {
            p.get_playback_status()
                .map(|s| s == PlaybackStatus::Playing)
                .unwrap_or(false)
        })
        .unwrap_or(&players[0]);

    let identity = player.identity().to_string();
    match input.action {
        Action::Play => {
            player.play().context("play")?;
            Ok(format!("playing on {identity}"))
        }
        Action::Pause => {
            player.pause().context("pause")?;
            Ok(format!("paused {identity}"))
        }
        Action::Next => {
            player.next().context("next")?;
            Ok(format!("skipped to next on {identity}"))
        }
        Action::Previous => {
            player.previous().context("previous")?;
            Ok(format!("skipped to previous on {identity}"))
        }
        Action::Volume => {
            // value: 0-100 (per the tool schema). MPRIS volume is 0.0-1.0
            // where 1.0 is the player's reference loudness (often "normal";
            // some players accept >1.0 as a boost).
            let target = input
                .value
                .ok_or_else(|| anyhow!("volume action needs a `value` (0-100)"))?;
            let normalized = (target / 100.0).clamp(0.0, 1.0);
            player
                .set_volume(normalized)
                .context("set_volume")?;
            Ok(format!("volume {target}% on {identity}"))
        }
    }
}

// ───────────────────────── macOS / Windows stubs ─────────────────────────

#[cfg(target_os = "macos")]
fn dispatch(_input: &MusicInput) -> Result<String> {
    // Future Phase 1.3.x: MediaRemote via osascript or the private framework.
    // Stub returns a clean error so the agent can apologise gracefully.
    Err(anyhow!(
        "macOS media control isn't wired yet — use Spotify or your keyboard's media keys"
    ))
}

#[cfg(target_os = "windows")]
fn dispatch(_input: &MusicInput) -> Result<String> {
    // Future: System Media Transport Controls via the winrt-* crates.
    Err(anyhow!(
        "Windows media control isn't wired yet — use Spotify or your keyboard's media keys"
    ))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn dispatch(_input: &MusicInput) -> Result<String> {
    Err(anyhow!("music_control: unsupported platform"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_actions() {
        for action in ["play", "pause", "next", "previous", "volume"] {
            let p: MusicInput = serde_json::from_value(json!({ "action": action })).unwrap();
            assert!(matches!(
                p.action,
                Action::Play | Action::Pause | Action::Next | Action::Previous | Action::Volume
            ));
        }
    }

    #[test]
    fn parses_query_and_value() {
        let p: MusicInput =
            serde_json::from_value(json!({ "action": "play", "query": "Wonderwall" })).unwrap();
        assert_eq!(p.query.as_deref(), Some("Wonderwall"));
        let p: MusicInput =
            serde_json::from_value(json!({ "action": "volume", "value": 75 })).unwrap();
        assert_eq!(p.value, Some(75.0));
    }

    #[test]
    fn rejects_query_play_with_clear_message() {
        // `dispatch` doesn't run for query+play; `execute` short-circuits.
        // Verify the message is the one the agent will read.
        let result = execute_synthetic(json!({ "action": "play", "query": "lo-fi" }));
        assert!(result.is_error);
        let text = result.result.as_str().unwrap_or_default();
        assert!(text.contains("Spotify"), "got: {text}");
        assert!(text.contains("Settings"), "got: {text}");
    }

    /// Test-only wrapper: simulate execute() without needing a real AppHandle.
    fn execute_synthetic(params: Value) -> ToolResult {
        let input: MusicInput = match serde_json::from_value(params) {
            Ok(v) => v,
            Err(err) => return ToolResult::err(format!("music_control: invalid parameters: {err}")),
        };
        if input.query.is_some() && input.action == Action::Play {
            return ToolResult::err(
                "music_control: searching for a specific track needs Spotify, which isn't connected yet — \
                 tell the user to connect Spotify in Settings (lands in Phase 1.3.x)."
                    .to_string(),
            );
        }
        ToolResult::ok(json!({ "status": "synthetic" }))
    }
}
