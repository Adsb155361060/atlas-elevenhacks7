//! `vision_qa` client tool — Claude reads what's on your screen.
//!
//! Flow (when the agent calls vision_qa({question, source?})):
//!   1. Capture a screenshot of the primary display.
//!      - macOS: `screencapture -x -t png` (system binary; no entitlements).
//!      - Linux: `grim` (Wayland) → `scrot` (X11) → fail with a clear message.
//!      - Windows: not wired for hackathon V1; returns is_error.
//!   2. POST the PNG bytes + question to Worker `/v1/tools/vision_qa` as
//!      multipart. Worker forwards to Anthropic vision and returns
//!      `{answer, model}`.
//!   3. Return the answer text to the agent via client_tool_result. The
//!      agent reads it aloud.
//!
//! Camera is intentionally out of scope for V1 — needs a webview path
//! through getUserMedia + MediaStreamTrack. Phase 3+.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::Command;
use tauri::{AppHandle, Runtime};
use tokio::runtime::Handle;

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct VisionInput {
    question: String,
    /// Reserved for future camera path. Defaults to "screen".
    #[serde(default)]
    source: Option<String>,
}

pub fn execute<R: Runtime>(_app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: VisionInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("vision_qa: invalid parameters: {err}")),
    };
    let source = input.source.as_deref().unwrap_or("screen");
    if source != "screen" {
        return ToolResult::err(format!(
            "vision_qa source '{source}' isn't supported yet — only 'screen'"
        ));
    }

    let png = match capture_screen() {
        Ok(bytes) => bytes,
        Err(err) => return ToolResult::err(format!("vision_qa: capture failed: {err:#}")),
    };
    log::info!(
        "vision_qa: captured {} bytes, calling worker with q='{}'",
        png.len(),
        truncate(&input.question, 80),
    );

    // Blocking → async bridge. The dispatcher runs on the tokio runtime
    // already (per voice/mod.rs::on_client_tool_call), but tools::dispatch
    // is sync. Use the current tokio handle to drive the upload.
    let handle = match Handle::try_current() {
        Ok(h) => h,
        Err(_) => return ToolResult::err("vision_qa: no tokio runtime available".to_string()),
    };
    let question = input.question.clone();
    let result = handle.block_on(upload_and_answer(question, png));
    match result {
        Ok(answer) => ToolResult::ok(json!({ "answer": answer })),
        Err(err) => ToolResult::err(format!("vision_qa: {err:#}")),
    }
}

// ───────────────────────── capture per OS ─────────────────────────

#[cfg(target_os = "macos")]
fn capture_screen() -> Result<Vec<u8>> {
    // `screencapture -x -t png -` writes PNG to stdout in modern macOS.
    let output = Command::new("/usr/sbin/screencapture")
        .arg("-x") // silent — no shutter sound
        .arg("-t").arg("png")
        .arg("-") // stdout
        .output()
        .context("invoke screencapture")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("screencapture exited {}: {stderr}", output.status));
    }
    if output.stdout.is_empty() {
        return Err(anyhow!("screencapture produced no bytes"));
    }
    Ok(output.stdout)
}

#[cfg(target_os = "linux")]
fn capture_screen() -> Result<Vec<u8>> {
    // Try Wayland (`grim`) then X11 (`scrot`). Both emit PNG to stdout
    // with `-`.
    if let Ok(out) = Command::new("grim").arg("-").output() {
        if out.status.success() && !out.stdout.is_empty() {
            return Ok(out.stdout);
        }
    }
    if let Ok(out) = Command::new("scrot").arg("-o").arg("-").output() {
        if out.status.success() && !out.stdout.is_empty() {
            return Ok(out.stdout);
        }
    }
    Err(anyhow!(
        "no screen-capture tool found — install grim (Wayland) or scrot (X11)"
    ))
}

#[cfg(target_os = "windows")]
fn capture_screen() -> Result<Vec<u8>> {
    // Phase 3+. Stub returns a clear error so the agent apologises.
    Err(anyhow!("Windows screen capture isn't wired yet"))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn capture_screen() -> Result<Vec<u8>> {
    Err(anyhow!("vision_qa: unsupported platform"))
}

// ───────────────────────── worker upload ─────────────────────────

async fn upload_and_answer(question: String, image_png: Vec<u8>) -> Result<String> {
    let worker_url = std::env::var("ATLAS_WORKER_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("ATLAS_WORKER_URL not set"))?;
    let token = std::env::var("ATLAS_AGENT_TOKEN")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("ATLAS_AGENT_TOKEN not set"))?;
    let endpoint = format!(
        "{}/v1/tools/vision_qa",
        worker_url.trim_end_matches('/'),
    );

    let part = reqwest::multipart::Part::bytes(image_png)
        .file_name("screenshot.png")
        .mime_str("image/png")
        .map_err(|e| anyhow!("invalid mime: {e}"))?;
    let form = reqwest::multipart::Form::new()
        .text("question", question)
        .part("image", part);

    let resp = reqwest::Client::new()
        .post(&endpoint)
        .bearer_auth(&token)
        .multipart(form)
        .send()
        .await
        .context("vision_qa POST")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("vision_qa worker {status}: {body}"));
    }
    #[derive(Deserialize)]
    struct VisionResponse {
        answer: String,
    }
    let parsed: VisionResponse = resp.json().await.context("vision_qa parse response")?;
    Ok(parsed.answer)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{cut}…")
    }
}
