//! `type_text` — dictate text into whatever has keyboard focus.
//!
//! Cross-platform synthetic typing, the foundation of Phase 4.4
//! voice-driven app operation. The user puts focus where they want
//! (an email reply, a chat box, a search bar), then says
//! *"Atlas, type 'thanks for the update'"*.
//!
//! Per-OS strategy:
//!   • macOS  — `osascript` + System Events `keystroke`.
//!   • Linux  — `xdotool type` (X11). Wayland needs `ydotool` running,
//!              which we attempt as a fallback but don't require.
//!   • Windows — PowerShell `[System.Windows.Forms.SendKeys]::SendWait`
//!              with SendKeys metacharacters escaped.
//!
//! Safety: the agent's prompt is responsible for not typing into the
//! wrong window. The tool itself just types — it can't tell whether
//! the focused field is a search box or an `rm -rf` terminal.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::Command;
use tauri::{AppHandle, Runtime};

use super::ToolResult;

const MAX_LEN: usize = 10_000;

#[derive(Debug, Deserialize)]
struct TypeInput {
    text: String,
    /// Press Enter after typing — handy for "type the message and send it".
    #[serde(default)]
    press_enter: bool,
}

pub fn execute<R: Runtime>(_app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: TypeInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("type_text: invalid parameters: {err}")),
    };
    if input.text.is_empty() {
        return ToolResult::err("type_text: 'text' is required");
    }
    if input.text.len() > MAX_LEN {
        return ToolResult::err(format!(
            "type_text: text too long ({} chars; max {MAX_LEN})",
            input.text.len()
        ));
    }
    match type_text(&input.text, input.press_enter) {
        Ok(()) => {
            log::info!(
                "type_text: typed {} chars (press_enter={})",
                input.text.len(),
                input.press_enter
            );
            ToolResult::ok(json!({
                "typed": true,
                "chars": input.text.len(),
            }))
        }
        Err(err) => ToolResult::err(format!("type_text: {err:#}")),
    }
}

#[cfg(target_os = "macos")]
fn type_text(text: &str, press_enter: bool) -> Result<()> {
    // Build an AppleScript that types the text then optionally presses Return.
    // We escape literal backslashes and double quotes so the string survives
    // the trip through `osascript -e`.
    let escaped = text.replace('\\', "\\\\").replace('"', "\\\"");
    let mut script = format!(
        r#"tell application "System Events" to keystroke "{escaped}""#
    );
    if press_enter {
        script.push_str(r#" delay 0.05
tell application "System Events" to key code 36"#);
    }
    let out = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .context("osascript")?;
    if !out.status.success() {
        return Err(anyhow!(
            "osascript failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn type_text(text: &str, press_enter: bool) -> Result<()> {
    // X11: xdotool. The `--` ends option parsing so text starting with `-`
    // doesn't confuse the parser. Small per-char delay (15ms) keeps fast
    // sustained typing from being dropped by chat apps with low-quality
    // input event handlers.
    let xdo = Command::new("xdotool")
        .args(["type", "--delay", "15", "--"])
        .arg(text)
        .status();
    if let Ok(s) = xdo {
        if s.success() {
            if press_enter {
                let _ = Command::new("xdotool").args(["key", "Return"]).status();
            }
            return Ok(());
        }
    }
    // Wayland fallback. ydotool needs `ydotoold` running as a daemon with
    // access to /dev/uinput — we try, but don't pretend to fix it.
    let yd = Command::new("ydotool").args(["type", "--", text]).status();
    if let Ok(s) = yd {
        if s.success() {
            if press_enter {
                let _ = Command::new("ydotool").args(["key", "28:1", "28:0"]).status();
            }
            return Ok(());
        }
    }
    Err(anyhow!(
        "neither xdotool (X11) nor ydotool (Wayland) succeeded — install xdotool, \
         or set up ydotool with /dev/uinput access on Wayland"
    ))
}

#[cfg(target_os = "windows")]
fn type_text(text: &str, press_enter: bool) -> Result<()> {
    // SendKeys treats `{}+^%~()` as metacharacters. Escape every literal
    // occurrence by wrapping in braces: `+` → `{+}`, `^` → `{^}`, etc.
    let mut escaped = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '+' | '^' | '%' | '~' | '(' | ')' | '{' | '}' | '[' | ']' => {
                escaped.push('{');
                escaped.push(ch);
                escaped.push('}');
            }
            '\n' => escaped.push_str("{ENTER}"),
            _ => escaped.push(ch),
        }
    }
    if press_enter {
        escaped.push_str("{ENTER}");
    }
    // We also need to escape PowerShell's own single-quote: each `'` in the
    // payload doubles itself inside a PS single-quoted string literal.
    let ps_literal = escaped.replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         [System.Windows.Forms.SendKeys]::SendWait('{ps_literal}')"
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .context("powershell SendKeys")?;
    if !out.status.success() {
        return Err(anyhow!(
            "SendKeys failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn type_text(_text: &str, _press_enter: bool) -> Result<()> {
    Err(anyhow!("type_text: unsupported platform"))
}
