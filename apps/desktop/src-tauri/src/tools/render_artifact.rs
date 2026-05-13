//! `render_artifact` client tool — the agent's hook for putting things on screen.
//!
//! Phase 1.1 ships the dispatch path: we validate the payload, emit an
//! `atlas:artifact` Tauri event (frontend consumes), and reply `rendered=true`.
//! The frontend's `ArtifactSurface` component (lands in Phase 2.1) is what
//! actually renders the map/chart/code/etc.; for now the desktop side just
//! logs receipt.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime};

use super::ToolResult;

/// Allowed artifact `type` field. Mirrors the registry definition in
/// `packages/contracts/src/tools/index.ts`. We accept anything the registry
/// declares and reject novel values — keeps frontend renderers from being
/// asked to handle types they don't know.
const KNOWN_TYPES: &[&str] = &[
    "map",
    "chart",
    "code",
    "markdown",
    "image",
    "audio",
    "table",
    "search_results",
    "tutorial",
];

#[derive(Debug, Deserialize)]
struct RenderInput {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    data: Value,
    #[serde(default)]
    narration: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ArtifactEvent {
    pub kind: String,
    pub data: Value,
    pub narration: Option<String>,
    /// Millis since UNIX epoch when the artifact was received — useful for
    /// the frontend's "render newest" tiebreaker if two arrive close together.
    pub received_at: u128,
}

pub fn execute<R: Runtime>(app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let parsed: RenderInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("render_artifact: invalid parameters: {err}")),
    };

    if !KNOWN_TYPES.contains(&parsed.kind.as_str()) {
        return ToolResult::err(format!(
            "render_artifact: unknown type '{}'. Allowed: {}",
            parsed.kind,
            KNOWN_TYPES.join(", ")
        ));
    }

    let event = ArtifactEvent {
        kind: parsed.kind,
        data: parsed.data,
        narration: parsed.narration,
        received_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
    };

    if let Err(err) = app.emit("atlas:artifact", &event) {
        return ToolResult::err(format!("render_artifact: emit failed: {err}"));
    }

    log::info!(
        "render_artifact: kind={} narration={:?}",
        event.kind,
        event.narration
    );
    ToolResult::ok(serde_json::json!({ "rendered": true }))
}
