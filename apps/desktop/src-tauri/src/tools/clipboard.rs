//! `read_clipboard` + `write_clipboard` — let Atlas peek + push to the
//! system clipboard.
//!
//! Backed by tauri-plugin-clipboard-manager (works on macOS/Linux/Windows).
//! Text-only for V1; images and other formats land later if useful.

use anyhow::Result;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use super::ToolResult;

pub fn read_execute<R: Runtime>(app: &AppHandle<R>, _parameters: &Value) -> ToolResult {
    match read(app) {
        Ok(text) => {
            let preview: String = text.chars().take(2000).collect();
            ToolResult::ok(json!({
                "text": preview,
                "length": text.chars().count(),
                "truncated": text.chars().count() > 2000,
            }))
        }
        Err(err) => ToolResult::err(format!("read_clipboard: {err:#}")),
    }
}

#[derive(Debug, Deserialize)]
struct WriteInput {
    text: String,
}

pub fn write_execute<R: Runtime>(app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: WriteInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("write_clipboard: invalid parameters: {err}")),
    };
    match write(app, &input.text) {
        Ok(_) => ToolResult::ok(json!({ "written": true, "length": input.text.chars().count() })),
        Err(err) => ToolResult::err(format!("write_clipboard: {err:#}")),
    }
}

fn read<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let text = app.clipboard().read_text()?;
    Ok(text)
}

fn write<R: Runtime>(app: &AppHandle<R>, text: &str) -> Result<()> {
    app.clipboard().write_text(text)?;
    Ok(())
}
