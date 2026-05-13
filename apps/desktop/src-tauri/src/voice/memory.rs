//! Conversation memory — short-horizon "recent context" injected into each
//! new agent session as a dynamic variable.
//!
//! Persisted to `conversation_history.json` via tauri-plugin-store. Each
//! turn is one struct with user text + agent reply + timestamp. On
//! `voice::start_session` we pull the last N turns, format them into a
//! single string, and pass it as `dynamic_variables.recent_context`. The
//! agent's system prompt has a "use recent context like background
//! knowledge, not transcript" instruction.
//!
//! Phase 5+ replaces this with semantic retrieval (vector search). The
//! short-horizon approach gets us "remembers what we just discussed"
//! without any embedding infrastructure.

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "conversation_history.json";
const KEY_TURNS: &str = "turns";
/// How many turns to retain on disk. ~50 covers a few weeks of casual use.
const MAX_TURNS: usize = 50;
/// How many of the most recent turns to inject as recent_context.
const CONTEXT_WINDOW: usize = 6;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Turn {
    pub user: String,
    pub agent: String,
    /// Epoch ms.
    pub ts: u128,
}

/// Live buffer for the current session. Filled as user_transcript + agent
/// responses come in; flushed to the store when the session ends.
#[derive(Default)]
pub struct LiveSession {
    inner: Mutex<LiveState>,
}

#[derive(Default)]
struct LiveState {
    user_buf: Option<String>,
    agent_buf: Option<String>,
}

impl LiveSession {
    pub fn ingest_user(&self, transcript: &str) {
        let mut s = self.inner.lock();
        // If we have a previous user_buf with no agent reply, the user
        // spoke twice without a response — concatenate.
        if let Some(prev) = s.user_buf.take() {
            s.user_buf = Some(format!("{prev} {transcript}"));
        } else {
            s.user_buf = Some(transcript.to_string());
        }
    }

    pub fn ingest_agent(&self, response: &str) {
        let mut s = self.inner.lock();
        s.agent_buf = Some(response.to_string());
    }

    /// Drain whatever's accumulated into a `Turn` (returns None if the
    /// pair is incomplete — neither half stands alone).
    pub fn take_completed(&self) -> Option<Turn> {
        let mut s = self.inner.lock();
        let user = s.user_buf.take()?;
        let agent = s.agent_buf.take()?;
        Some(Turn {
            user: user.trim().to_string(),
            agent: agent.trim().to_string(),
            ts: now_ms(),
        })
    }
}

/// Append a completed turn to disk, evicting the oldest if at cap.
pub fn append_turn<R: Runtime>(app: &AppHandle<R>, turn: Turn) -> Result<()> {
    let store = app.store(STORE_FILE).map_err(|e| anyhow!("open store: {e}"))?;
    let mut turns = load_turns(&store);
    turns.push(turn);
    while turns.len() > MAX_TURNS {
        turns.remove(0);
    }
    store.set(KEY_TURNS, serde_json::to_value(&turns).unwrap_or_default());
    store.save().context("store save")?;
    Ok(())
}

/// Build the `recent_context` string the agent reads as background. Picks
/// the last `CONTEXT_WINDOW` turns and renders them as a `User: …\nAtlas:
/// …` block — easy for Claude to chunk.
pub fn recent_context<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let store = app.store(STORE_FILE).ok()?;
    let turns = load_turns(&store);
    if turns.is_empty() {
        return None;
    }
    let start = turns.len().saturating_sub(CONTEXT_WINDOW);
    let mut out = String::with_capacity(1024);
    for turn in &turns[start..] {
        // Cap each side at 300 chars so the context string stays under
        // ~3-4 KB even with a full window.
        let user = truncate(&turn.user, 300);
        let agent = truncate(&turn.agent, 300);
        out.push_str("User: ");
        out.push_str(&user);
        out.push('\n');
        out.push_str("Atlas: ");
        out.push_str(&agent);
        out.push_str("\n\n");
    }
    Some(out.trim_end().to_string())
}

/// Wipe all stored turns. Called from Settings → Privacy → Reset.
pub fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let store = app.store(STORE_FILE).map_err(|e| anyhow!("open store: {e}"))?;
    store.delete(KEY_TURNS);
    store.save().context("store save")?;
    log::info!("memory: cleared all turns");
    Ok(())
}

fn load_turns<R: Runtime>(store: &Arc<tauri_plugin_store::Store<R>>) -> Vec<Turn> {
    store
        .get(KEY_TURNS)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max - 1).collect();
        format!("{cut}…")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_session_pairs_user_and_agent() {
        let s = LiveSession::default();
        assert!(s.take_completed().is_none());
        s.ingest_user("what's the weather");
        assert!(s.take_completed().is_none());
        s.ingest_user("what's the weather"); // re-set the buffer
        s.ingest_agent("sunny and 72");
        let turn = s.take_completed().unwrap();
        assert_eq!(turn.user, "what's the weather");
        assert_eq!(turn.agent, "sunny and 72");
    }

    #[test]
    fn truncate_caps_at_max() {
        let long = "x".repeat(400);
        let cut = truncate(&long, 100);
        assert_eq!(cut.chars().count(), 100);
        assert!(cut.ends_with('…'));
    }
}
