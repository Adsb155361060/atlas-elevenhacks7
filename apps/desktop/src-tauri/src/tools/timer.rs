//! `set_timer` — schedule a one-shot reminder.
//!
//! Emits `atlas:timer:start` with the target epoch-ms so the frontend can
//! render a countdown card. When the timer fires we emit `atlas:timer:fire`
//! and a system notification via tauri-plugin-notification. The frontend
//! can also use `atlas:timer:cancel` if the user changes their mind.
//!
//! Multiple concurrent timers are fine — each gets its own id.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_notification::NotificationExt;

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct TimerInput {
    /// Duration in seconds (5 - 14400 = 5s to 4 hours).
    seconds: u64,
    /// User-facing label, e.g. "Pasta ready". Defaults to "Timer done".
    #[serde(default)]
    label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct TimerStartEvent {
    id: String,
    label: String,
    seconds: u64,
    target_ms: u128,
}

pub fn execute<R: Runtime>(app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: TimerInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("set_timer: invalid parameters: {err}")),
    };
    if let Err(err) = schedule(app, &input) {
        return ToolResult::err(format!("set_timer: {err:#}"));
    }
    ToolResult::ok(json!({
        "scheduled": true,
        "seconds": input.seconds,
    }))
}

fn schedule<R: Runtime>(app: &AppHandle<R>, input: &TimerInput) -> Result<()> {
    if input.seconds < 5 || input.seconds > 14_400 {
        return Err(anyhow!("seconds must be 5–14400 (5s to 4 hours)"));
    }
    let label = input
        .label
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("Timer done")
        .to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_millis();
    let target_ms = now + u128::from(input.seconds) * 1000;
    let id = format!("timer_{now}");

    app.emit(
        "atlas:timer:start",
        TimerStartEvent {
            id: id.clone(),
            label: label.clone(),
            seconds: input.seconds,
            target_ms,
        },
    )
    .ok();

    let app_handle = app.clone();
    let secs = input.seconds;
    let id_clone = id.clone();
    let label_clone = label.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(secs)).await;
        // Best-effort system notification — falls back silently if the user
        // hasn't granted notification permission yet.
        let _ = app_handle
            .notification()
            .builder()
            .title("Atlas timer")
            .body(&label_clone)
            .show();
        let _ = app_handle.emit(
            "atlas:timer:fire",
            json!({ "id": id_clone, "label": label_clone }),
        );
        log::info!("timer fired: {id_clone} ({label_clone})");
    });

    log::info!("timer scheduled: {id} {secs}s '{label}'");
    Ok(())
}
