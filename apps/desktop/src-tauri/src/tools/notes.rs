//! `take_note` + `list_notes` — persisted personal notes.
//!
//! Backed by `tauri-plugin-store` at `notes.json` in the OS config dir
//! (~/Library/Application Support/com.atlas.desktop/ on macOS). Each note
//! has a unique id, timestamp, optional title + tags.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use super::ToolResult;

const STORE_FILE: &str = "notes.json";
const KEY_ALL: &str = "notes";
const MAX_NOTES: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub body: String,
    pub title: Option<String>,
    pub tags: Vec<String>,
    /// Epoch milliseconds.
    pub created_at: u128,
}

// ───────────────────────── take_note ─────────────────────────

#[derive(Debug, Deserialize)]
struct TakeInput {
    body: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
}

pub fn take_execute<R: Runtime>(app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: TakeInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("take_note: invalid parameters: {err}")),
    };
    if input.body.trim().is_empty() {
        return ToolResult::err("take_note: body is required".to_string());
    }
    match save(app, &input) {
        Ok(note) => ToolResult::ok(json!({
            "saved": true,
            "id": note.id,
            "title": note.title,
            "created_at": note.created_at,
        })),
        Err(err) => ToolResult::err(format!("take_note: {err}")),
    }
}

fn save<R: Runtime>(app: &AppHandle<R>, input: &TakeInput) -> Result<Note> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| anyhow!("open store: {e}"))?;
    let mut notes = load_all(&store);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let note = Note {
        id: format!("note_{now}"),
        body: input.body.trim().to_string(),
        title: input
            .title
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        tags: input
            .tags
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect(),
        created_at: now,
    };
    notes.push(note.clone());
    while notes.len() > MAX_NOTES {
        notes.remove(0);
    }
    store.set(KEY_ALL, serde_json::to_value(&notes).unwrap_or_default());
    store.save().context("store save")?;
    log::info!("notes: saved {} ({} chars)", note.id, note.body.len());
    Ok(note)
}

// ───────────────────────── list_notes ─────────────────────────

#[derive(Debug, Deserialize)]
struct ListInput {
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    tag: Option<String>,
    #[serde(default)]
    limit: Option<u32>,
}

pub fn list_execute<R: Runtime>(app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: ListInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("list_notes: invalid parameters: {err}")),
    };
    let store = match app.store(STORE_FILE) {
        Ok(s) => s,
        Err(err) => return ToolResult::err(format!("list_notes: open store: {err}")),
    };
    let notes = load_all(&store);
    let limit = input.limit.unwrap_or(10).clamp(1, 50) as usize;
    let q = input.query.as_deref().unwrap_or("").trim().to_lowercase();
    let tag = input.tag.as_deref().unwrap_or("").trim().to_lowercase();
    let filtered: Vec<&Note> = notes
        .iter()
        .rev() // newest first
        .filter(|n| {
            if !q.is_empty() {
                let hay = format!("{} {}", n.title.as_deref().unwrap_or(""), n.body).to_lowercase();
                if !hay.contains(&q) {
                    return false;
                }
            }
            if !tag.is_empty() && !n.tags.iter().any(|t| t.to_lowercase() == tag) {
                return false;
            }
            true
        })
        .take(limit)
        .collect();
    ToolResult::ok(json!({
        "count": filtered.len(),
        "notes": filtered,
    }))
}

fn load_all<R: Runtime>(store: &std::sync::Arc<tauri_plugin_store::Store<R>>) -> Vec<Note> {
    store
        .get(KEY_ALL)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}
