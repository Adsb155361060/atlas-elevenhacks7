//! `compose_email` — opens the user's default mail client (or web Gmail) with
//! a pre-filled draft, ready for the user to glance at and hit Send.
//!
//! Strategy: build a `mailto:` URL with the dictated fields percent-encoded
//! per RFC 3986 and hand it to the OS URL handler (`xdg-open`, `open`,
//! `cmd /c start`). The OS routes it to whatever the user has set as their
//! default mailto handler — Outlook, Mail.app, Thunderbird, or Gmail web
//! (when "always open Gmail" is enabled in Chrome / Firefox).
//!
//! This is the "no setup" path. Fully hands-free sending requires the Gmail
//! API and lives in `send_email.rs`.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::Command;
use tauri::{AppHandle, Runtime};

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct ComposeInput {
    to: String,
    #[serde(default)]
    subject: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    cc: Option<String>,
    #[serde(default)]
    bcc: Option<String>,
}

pub fn execute<R: Runtime>(_app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: ComposeInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("compose_email: invalid parameters: {err}")),
    };
    if input.to.trim().is_empty() {
        return ToolResult::err("compose_email: 'to' is required".to_string());
    }
    let url = build_mailto(&input);
    match open_url(&url) {
        Ok(()) => {
            log::info!(
                "compose_email: opened draft to={} subject={:?}",
                input.to,
                input.subject
            );
            ToolResult::ok(json!({
                "composed": true,
                "to": input.to,
                "subject": input.subject,
            }))
        }
        Err(err) => ToolResult::err(format!("compose_email: {err:#}")),
    }
}

fn build_mailto(i: &ComposeInput) -> String {
    let mut pairs: Vec<(&str, &str)> = Vec::new();
    let s = i.subject.as_deref().unwrap_or("");
    let b = i.body.as_deref().unwrap_or("");
    let cc = i.cc.as_deref().unwrap_or("");
    let bcc = i.bcc.as_deref().unwrap_or("");
    if !s.is_empty() {
        pairs.push(("subject", s));
    }
    if !b.is_empty() {
        pairs.push(("body", b));
    }
    if !cc.is_empty() {
        pairs.push(("cc", cc));
    }
    if !bcc.is_empty() {
        pairs.push(("bcc", bcc));
    }
    let qs = pairs
        .iter()
        .map(|(k, v)| format!("{k}={}", pct(v)))
        .collect::<Vec<_>>()
        .join("&");
    if qs.is_empty() {
        format!("mailto:{}", pct(&i.to))
    } else {
        format!("mailto:{}?{}", pct(&i.to), qs)
    }
}

/// RFC 3986 percent-encoding for the unreserved set. Mailto bodies are sent
/// literally with `%XX` (not `+`-encoded form-urlencoded), so this is the
/// right encoder for the `subject` / `body` / `cc` / `bcc` parameters.
fn pct(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(target_os = "linux")]
fn open_url(url: &str) -> Result<()> {
    let status = Command::new("xdg-open")
        .arg(url)
        .status()
        .context("xdg-open")?;
    if !status.success() {
        return Err(anyhow!("xdg-open exited {status}"));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) -> Result<()> {
    let status = Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .context("open")?;
    if !status.success() {
        return Err(anyhow!("open exited {status}"));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn open_url(url: &str) -> Result<()> {
    // cmd /c start "" "<url>" — the empty title arg is required so `start`
    // doesn't interpret the URL as a window title when it contains spaces.
    let status = Command::new("cmd")
        .args(["/c", "start", "", url])
        .status()
        .context("start")?;
    if !status.success() {
        return Err(anyhow!("start exited {status}"));
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn open_url(_url: &str) -> Result<()> {
    Err(anyhow!("compose_email: unsupported platform"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pct_encodes_unreserved_as_is() {
        assert_eq!(pct("Hello-World_1.2~3"), "Hello-World_1.2~3");
    }

    #[test]
    fn pct_encodes_space_and_specials() {
        assert_eq!(pct("Hi there!"), "Hi%20there%21");
        assert_eq!(pct("a&b=c"), "a%26b%3Dc");
    }

    #[test]
    fn build_mailto_to_only() {
        let i = ComposeInput {
            to: "a@b.com".into(),
            subject: None,
            body: None,
            cc: None,
            bcc: None,
        };
        assert_eq!(build_mailto(&i), "mailto:a%40b.com");
    }

    #[test]
    fn build_mailto_with_subject_and_body() {
        let i = ComposeInput {
            to: "a@b.com".into(),
            subject: Some("Hi there".into()),
            body: Some("Line 1\nLine 2".into()),
            cc: None,
            bcc: None,
        };
        let url = build_mailto(&i);
        assert!(url.starts_with("mailto:a%40b.com?"));
        assert!(url.contains("subject=Hi%20there"));
        assert!(url.contains("body=Line%201%0ALine%202"));
    }
}
