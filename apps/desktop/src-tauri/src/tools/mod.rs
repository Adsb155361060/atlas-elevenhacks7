//! Desktop-side client tools.
//!
//! Tools that need OS access (window management, file system, OS controls)
//! live here. When the agent emits `client_tool_call`, the voice
//! orchestrator routes the call through `dispatch` and returns
//! `client_tool_result` back to the agent.
//!
//! Cloud-side tools (`web_search`, `fetch_data`, …) live on the Worker and
//! never reach this dispatcher.
//!
//! Phase 1.1 ships `render_artifact` so the agent's voice replies can be
//! paired with on-screen detail. Phase 1.2–1.6 add `launch_app`,
//! `music_control`, `open_path`, `find_files`, `system_action`.

mod battery_status;
mod calendar;
mod clipboard;
mod compose_email;
mod find_files;
mod launch_app;
mod lock_screen;
mod music_control;
mod notes;
mod open_path;
mod render_artifact;
mod screenshot;
mod send_email;
mod system_action;
mod timer;
pub mod vision_qa;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub result: Value,
    pub is_error: bool,
}

impl ToolResult {
    pub fn ok(value: Value) -> Self {
        Self {
            result: value,
            is_error: false,
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self {
            result: Value::String(message.into()),
            is_error: true,
        }
    }
}

/// Dispatch a `client_tool_call` from the agent. Returns the payload the
/// orchestrator should put in `client_tool_result` along with `is_error`.
pub fn dispatch<R: Runtime>(app: &AppHandle<R>, name: &str, parameters: &Value) -> ToolResult {
    log::info!("tools: dispatch '{name}'");
    match name {
        "render_artifact" => render_artifact::execute(app, parameters),
        "launch_app" => launch_app::execute(app, parameters),
        "music_control" => music_control::execute(app, parameters),
        "vision_qa" => vision_qa::execute(app, parameters),
        "open_path" => open_path::execute(app, parameters),
        "find_files" => find_files::execute(app, parameters),
        "system_action" => system_action::execute(app, parameters),
        "take_note" => notes::take_execute(app, parameters),
        "list_notes" => notes::list_execute(app, parameters),
        "read_clipboard" => clipboard::read_execute(app, parameters),
        "write_clipboard" => clipboard::write_execute(app, parameters),
        "set_timer" => timer::execute(app, parameters),
        "calendar_today" => calendar::execute(app, parameters),
        "battery_status" => battery_status::execute(app, parameters),
        "lock_screen" => lock_screen::execute(app, parameters),
        "screenshot" => screenshot::execute(app, parameters),
        "compose_email" => compose_email::execute(app, parameters),
        "send_email" => send_email::execute(app, parameters),
        other => ToolResult::err(format!(
            "tool '{other}' is not implemented on the desktop client (Phase 1.x)"
        )),
    }
}
