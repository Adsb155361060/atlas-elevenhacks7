//! `send_email` — send an email hands-free via the Gmail API (OAuth refresh-token flow).
//!
//! Requires three env vars on the user's machine:
//!   - GMAIL_OAUTH_CLIENT_ID
//!   - GMAIL_OAUTH_CLIENT_SECRET
//!   - GMAIL_OAUTH_REFRESH_TOKEN
//!
//! One-time setup: see `docs/runbooks/gmail-oauth-setup.md`. Until those env
//! vars are populated this tool returns a clear configuration error, and the
//! agent falls back to the always-works `compose_email` (which opens a
//! prefilled draft in the default mail client).
//!
//! Flow per call:
//!   1. Exchange the long-lived refresh token for a fresh access token.
//!   2. Build an RFC 5322 plain-text message.
//!   3. POST it to `gmail.googleapis.com/.../messages/send` base64url-encoded.

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};
use tokio::runtime::Handle;

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct SendInput {
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
    let input: SendInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("send_email: invalid parameters: {err}")),
    };
    if input.to.trim().is_empty() {
        return ToolResult::err("send_email: 'to' is required".to_string());
    }
    let handle = match Handle::try_current() {
        Ok(h) => h,
        Err(_) => return ToolResult::err("send_email: no tokio runtime available"),
    };
    // block_in_place lets us synchronously await on the Tokio multi-thread
    // runtime — same pattern as vision_qa. Gmail's HTTP calls are short
    // (token swap + send) so this stays well under any orchestrator timeout.
    match tokio::task::block_in_place(|| handle.block_on(send(input))) {
        Ok((id, thread_id)) => ToolResult::ok(json!({
            "sent": true,
            "message_id": id,
            "thread_id": thread_id,
        })),
        Err(err) => ToolResult::err(format!("send_email: {err:#}")),
    }
}

async fn send(i: SendInput) -> Result<(String, String)> {
    let client_id = env_required("GMAIL_OAUTH_CLIENT_ID")?;
    let client_secret = env_required("GMAIL_OAUTH_CLIENT_SECRET")?;
    let refresh_token = env_required("GMAIL_OAUTH_REFRESH_TOKEN")?;

    // 1. Refresh-token grant → access token.
    let token_resp = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .context("oauth token request")?;
    if !token_resp.status().is_success() {
        let status = token_resp.status();
        let body = token_resp.text().await.unwrap_or_default();
        return Err(anyhow!("oauth token {status}: {}", truncate(&body, 200)));
    }
    let token_json: Value = token_resp.json().await.context("parse oauth token")?;
    let access_token = token_json
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("OAuth response missing access_token: {token_json}"))?
        .to_string();

    // 2. Build an RFC 5322 plain-text message.
    let raw = encode_rfc5322(&i);

    // 3. POST to Gmail API messages.send.
    let send_resp = reqwest::Client::new()
        .post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
        .bearer_auth(&access_token)
        .json(&json!({ "raw": raw }))
        .send()
        .await
        .context("gmail send")?;
    if !send_resp.status().is_success() {
        let status = send_resp.status();
        let body = send_resp.text().await.unwrap_or_default();
        return Err(anyhow!("gmail send {status}: {}", truncate(&body, 200)));
    }
    let parsed: Value = send_resp.json().await.context("parse gmail send response")?;
    let id = parsed
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let thread_id = parsed
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Ok((id, thread_id))
}

fn env_required(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            anyhow!(
                "{name} not set — Gmail-API sending isn't configured yet. See \
                 docs/runbooks/gmail-oauth-setup.md to wire it up (one-time), \
                 or use compose_email instead to open a prefilled draft."
            )
        })
}

fn encode_rfc5322(i: &SendInput) -> String {
    let mut msg = String::new();
    msg.push_str(&format!("To: {}\r\n", i.to.trim()));
    if let Some(cc) = i.cc.as_deref().filter(|s| !s.trim().is_empty()) {
        msg.push_str(&format!("Cc: {cc}\r\n"));
    }
    if let Some(bcc) = i.bcc.as_deref().filter(|s| !s.trim().is_empty()) {
        msg.push_str(&format!("Bcc: {bcc}\r\n"));
    }
    if let Some(s) = i.subject.as_deref().filter(|s| !s.trim().is_empty()) {
        msg.push_str(&format!("Subject: {s}\r\n"));
    }
    msg.push_str("MIME-Version: 1.0\r\n");
    msg.push_str("Content-Type: text/plain; charset=utf-8\r\n");
    msg.push_str("\r\n");
    if let Some(b) = i.body.as_deref() {
        msg.push_str(b);
    }
    URL_SAFE_NO_PAD.encode(msg.as_bytes())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc5322_has_required_headers_and_body() {
        let i = SendInput {
            to: "boss@example.com".into(),
            subject: Some("Status update".into()),
            body: Some("Sprint 4 is on track.".into()),
            cc: None,
            bcc: None,
        };
        let raw = encode_rfc5322(&i);
        let decoded = URL_SAFE_NO_PAD.decode(&raw).unwrap();
        let text = String::from_utf8(decoded).unwrap();
        assert!(text.starts_with("To: boss@example.com\r\n"));
        assert!(text.contains("Subject: Status update\r\n"));
        assert!(text.contains("MIME-Version: 1.0\r\n"));
        assert!(text.contains("Content-Type: text/plain; charset=utf-8\r\n"));
        assert!(text.ends_with("Sprint 4 is on track."));
    }

    #[test]
    fn rfc5322_omits_blank_optional_headers() {
        let i = SendInput {
            to: "x@y.com".into(),
            subject: None,
            body: None,
            cc: Some("".into()),
            bcc: Some("   ".into()),
        };
        let raw = encode_rfc5322(&i);
        let text = String::from_utf8(URL_SAFE_NO_PAD.decode(&raw).unwrap()).unwrap();
        assert!(!text.contains("Cc:"));
        assert!(!text.contains("Bcc:"));
        assert!(!text.contains("Subject:"));
    }
}
