//! `calendar_today` client tool — read today's events from the system
//! calendar.
//!
//! macOS: osascript queries Calendar.app. Reads `start date`, `end date`,
//! `summary`, `location` across every visible calendar. Returns a tidy JSON
//! array the agent can speak from + the artifact surface can render.
//!
//! Linux/Windows: deferred. macOS has the simplest no-OAuth path and is the
//! judges' target.

#[cfg(target_os = "macos")]
use anyhow::Context;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(target_os = "macos")]
use std::process::Command;
use tauri::{AppHandle, Runtime};

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct CalendarInput {
    /// Optional ISO 8601 date (YYYY-MM-DD). Defaults to today.
    #[serde(default)]
    date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CalEvent {
    pub title: String,
    pub start: String,
    pub end: String,
    pub calendar: String,
    pub location: Option<String>,
}

pub fn execute<R: Runtime>(_app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: CalendarInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("calendar_today: invalid parameters: {err}")),
    };
    match fetch_events(input.date.as_deref()) {
        Ok(events) => ToolResult::ok(json!({
            "count": events.len(),
            "events": events,
        })),
        Err(err) => ToolResult::err(format!("calendar_today: {err:#}")),
    }
}

#[cfg(target_os = "macos")]
fn fetch_events(date_iso: Option<&str>) -> Result<Vec<CalEvent>> {
    // AppleScript builds today's window (or the requested ISO date) and walks
    // every calendar's events whose start is within it. The output is one
    // tab-separated line per event, terminated by a sentinel so we can tell
    // an empty result from an error.
    let date_clause = match date_iso {
        Some(iso) => {
            // Validate shape — yyyy-mm-dd — and split.
            let parts: Vec<&str> = iso.split('-').collect();
            if parts.len() != 3 {
                return Err(anyhow!("date must be YYYY-MM-DD"));
            }
            format!(
                r#"
                set targetDate to current date
                set year of targetDate to {y}
                set month of targetDate to {m}
                set day of targetDate to {d}
                set hours of targetDate to 0
                set minutes of targetDate to 0
                set seconds of targetDate to 0
                "#,
                y = parts[0],
                m = parts[1].trim_start_matches('0'),
                d = parts[2].trim_start_matches('0'),
            )
        }
        None => r#"
            set targetDate to current date
            set hours of targetDate to 0
            set minutes of targetDate to 0
            set seconds of targetDate to 0
        "#
        .to_string(),
    };

    let script = format!(
        r#"
{date_clause}
set windowEnd to targetDate + 24 * hours

set out to ""
tell application "Calendar"
    set cals to every calendar
    repeat with c in cals
        set evts to (every event of c whose start date ≥ targetDate and start date < windowEnd)
        repeat with e in evts
            set t to (summary of e) as text
            set s to (start date of e) as text
            set f to (end date of e) as text
            set calName to (title of c) as text
            try
                set loc to (location of e) as text
            on error
                set loc to ""
            end try
            set out to out & t & tab & s & tab & f & tab & calName & tab & loc & linefeed
        end repeat
    end repeat
end tell
return out & "EOM"
"#
    );

    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .context("osascript")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(anyhow!(
            "osascript failed (Calendar.app permission?) — {stderr}"
        ));
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let body = raw.trim_end_matches('\n').trim_end_matches("EOM");
    let mut events = Vec::new();
    for line in body.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(5, '\t').collect();
        if parts.len() < 4 {
            continue;
        }
        events.push(CalEvent {
            title: parts[0].trim().to_string(),
            start: parts[1].trim().to_string(),
            end: parts[2].trim().to_string(),
            calendar: parts[3].trim().to_string(),
            location: parts
                .get(4)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
        });
    }
    // Calendar.app returns events in calendar-order, not chronological.
    events.sort_by(|a, b| a.start.cmp(&b.start));
    log::info!("calendar_today: {} events", events.len());
    Ok(events)
}

#[cfg(not(target_os = "macos"))]
fn fetch_events(_date_iso: Option<&str>) -> Result<Vec<CalEvent>> {
    Err(anyhow!(
        "calendar_today: only macOS Calendar.app is wired in V1"
    ))
}
