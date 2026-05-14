//! `vision_qa` client tool — Claude reads what's on your screen or
//! what's in front of your camera.
//!
//! Flow (when the agent calls vision_qa({question, source?})):
//!   1. Capture an image:
//!      - `source: "screen"` (default) — runs an OS-level capture
//!        (`screencapture` on macOS, `grim`/`scrot` on Linux).
//!      - `source: "camera"` — emits `atlas:vision:capture_camera` to
//!        the webview, which calls `getUserMedia` + canvas to snap a
//!        frame and delivers it back via the `vision_camera_deliver`
//!        Tauri command. Bridge via an in-process oneshot map.
//!   2. POST PNG + question to Worker `/v1/tools/vision_qa` as
//!      multipart. Worker forwards to Anthropic vision and returns
//!      `{answer, model}`.
//!   3. Return the answer text to the agent via client_tool_result.

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::process::Command;
use std::sync::OnceLock;
#[cfg(not(target_os = "linux"))]
use std::time::Duration;
use tauri::{AppHandle, Runtime};
#[cfg(not(target_os = "linux"))]
use tauri::Emitter;
use tokio::runtime::Handle;
use tokio::sync::oneshot;

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct VisionInput {
    question: String,
    /// `screen` (default) or `camera`.
    #[serde(default)]
    source: Option<String>,
}

pub fn execute<R: Runtime>(app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: VisionInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("vision_qa: invalid parameters: {err}")),
    };
    let source = input.source.as_deref().unwrap_or("screen");

    let handle = match Handle::try_current() {
        Ok(h) => h,
        Err(_) => return ToolResult::err("vision_qa: no tokio runtime available".to_string()),
    };

    // `execute` runs synchronously on a Tokio runtime worker (Tauri's
    // async_runtime::spawn → tool dispatch). A naked `handle.block_on(...)`
    // from inside an active runtime panics with:
    //   "Cannot start a runtime from within a runtime"
    // because Tokio refuses to let a worker block on another runtime call.
    //
    // `block_in_place` tells Tokio to relocate the worker's pending tasks
    // onto other threads first, freeing the current thread to actually
    // block. After that, `block_on` is legal. block_in_place itself
    // requires a multi-threaded runtime, which Tauri uses by default.
    let png = match source {
        "screen" => match capture_screen() {
            Ok(b) => b,
            Err(err) => return ToolResult::err(format!("vision_qa: capture screen: {err:#}")),
        },
        "camera" => match capture_camera_dispatch(app, &handle) {
            Ok(b) => b,
            Err(err) => return ToolResult::err(format!("vision_qa: capture camera: {err:#}")),
        },
        other => {
            return ToolResult::err(format!(
                "vision_qa: source '{other}' invalid — use 'screen' or 'camera'"
            ))
        }
    };
    log::info!(
        "vision_qa: source={source} bytes={} q='{}'",
        png.len(),
        truncate(&input.question, 80),
    );

    let question = input.question.clone();
    match tokio::task::block_in_place(|| handle.block_on(upload_and_answer(question, png))) {
        Ok(answer) => ToolResult::ok(json!({ "answer": answer, "source": source })),
        Err(err) => ToolResult::err(format!("vision_qa: {err:#}")),
    }
}

// ───────────────────────── screen capture per OS ─────────────────────────

#[cfg(target_os = "macos")]
fn capture_screen() -> Result<Vec<u8>> {
    let output = Command::new("/usr/sbin/screencapture")
        .arg("-x")
        .arg("-t")
        .arg("png")
        .arg("-")
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
    Err(anyhow!("Windows screen capture isn't wired yet"))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn capture_screen() -> Result<Vec<u8>> {
    Err(anyhow!("vision_qa: unsupported platform"))
}

// ───────────────────────── camera capture dispatch ─────────────────────────
//
// Two strategies, picked by platform:
//
//   • Linux  → native v4l2 capture via ffmpeg (`capture_camera_linux`).
//     WebKit2GTK's embedded webview denies `getUserMedia` for Tauri-loaded
//     content by default, so the webview bridge silently fails there and
//     the agent sees "empty bytes". Going straight to /dev/video* through
//     ffmpeg sidesteps the webview entirely — same approach as our
//     grim/scrot screen capture.
//
//   • macOS / Windows → webview `getUserMedia` bridge (`capture_camera`).
//     There the WebView relays the OS permission prompt correctly and
//     getUserMedia works; no native v4l2 equivalent needed.

fn capture_camera_dispatch<R: Runtime>(app: &AppHandle<R>, handle: &Handle) -> Result<Vec<u8>> {
    #[cfg(target_os = "linux")]
    {
        let _ = (app, handle); // unused on Linux — native path takes over
        capture_camera_linux()
    }
    #[cfg(not(target_os = "linux"))]
    {
        tokio::task::block_in_place(|| handle.block_on(capture_camera(app)))
    }
}

/// Capture one frame from the default V4L2 device via ffmpeg. ffmpeg ships
/// (or is one `apt install` away) on essentially every Linux desktop, and
/// `-f image2pipe -vcodec png -` streams a single PNG to stdout.
#[cfg(target_os = "linux")]
fn capture_camera_linux() -> Result<Vec<u8>> {
    // Try the common device nodes in order. Most laptops expose the
    // built-in cam at /dev/video0; some enumerate metadata nodes first so
    // /dev/video1+ can be the real stream.
    let devices = ["/dev/video0", "/dev/video1", "/dev/video2"];
    let mut last_err = String::new();
    for dev in devices {
        if !std::path::Path::new(dev).exists() {
            continue;
        }
        let out = Command::new("ffmpeg")
            .args([
                "-loglevel", "error",
                "-f", "v4l2",
                "-i", dev,
                "-frames:v", "1",
                "-f", "image2pipe",
                "-vcodec", "png",
                "-",
            ])
            .output();
        match out {
            Ok(o) if o.status.success() && !o.stdout.is_empty() => return Ok(o.stdout),
            Ok(o) => {
                last_err = format!(
                    "ffmpeg on {dev} exited {}: {}",
                    o.status,
                    String::from_utf8_lossy(&o.stderr).trim()
                );
            }
            Err(e) => {
                last_err = format!("ffmpeg not runnable ({e}) — install it: sudo apt install ffmpeg");
                break;
            }
        }
    }
    if last_err.is_empty() {
        Err(anyhow!(
            "no /dev/video* device found — is a camera connected?"
        ))
    } else {
        Err(anyhow!("{last_err}"))
    }
}

// ───────────────────────── webview camera bridge (macOS/Windows) ─────────
//
// Rust can't reach the webcam from inside a Tauri app without a native
// plugin. The webview can — `getUserMedia` + a `<canvas>` snapshot gives
// us PNG bytes. To bridge:
//   1. Rust emits `atlas:vision:capture_camera` with a request_id.
//   2. Frontend listens, captures a frame, base64-encodes it, calls the
//      `vision_camera_deliver` Tauri command with the same request_id.
//   3. That command resolves a pending tokio::sync::oneshot, freeing
//      `capture_camera` to continue.

type CameraBridge = Mutex<HashMap<String, oneshot::Sender<Vec<u8>>>>;

fn bridge() -> &'static CameraBridge {
    static BRIDGE: OnceLock<CameraBridge> = OnceLock::new();
    BRIDGE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(not(target_os = "linux"))]
async fn capture_camera<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<u8>> {
    let request_id = format!("cam_{}", now_ms());
    let (tx, rx) = oneshot::channel::<Vec<u8>>();
    bridge().lock().insert(request_id.clone(), tx);

    let _ = app.emit(
        "atlas:vision:capture_camera",
        json!({ "request_id": request_id }),
    );

    // 8s grace covers permission-prompt-on-first-use + stream-start.
    match tokio::time::timeout(Duration::from_secs(8), rx).await {
        Ok(Ok(bytes)) => {
            if bytes.is_empty() {
                Err(anyhow!("camera returned empty bytes"))
            } else {
                Ok(bytes)
            }
        }
        Ok(Err(_)) => Err(anyhow!("camera response channel dropped")),
        Err(_) => {
            // Clean up the pending entry on timeout.
            bridge().lock().remove(&request_id);
            Err(anyhow!(
                "camera capture timed out — did you grant camera permission?"
            ))
        }
    }
}

/// Called from `commands::vision_camera_deliver`. Decodes the base64 PNG
/// the frontend produced and routes it to the waiting oneshot. Returns
/// `Ok(())` if the request id was found; `Err` otherwise.
pub fn deliver_camera_capture(request_id: &str, base64_png: &str) -> Result<()> {
    let bytes = STANDARD
        .decode(
            base64_png
                .trim_start_matches("data:image/png;base64,")
                .as_bytes(),
        )
        .context("base64 decode camera bytes")?;
    let tx = bridge()
        .lock()
        .remove(request_id)
        .ok_or_else(|| anyhow!("no pending camera request for id '{request_id}'"))?;
    tx.send(bytes)
        .map_err(|_| anyhow!("oneshot receiver dropped before delivery"))?;
    Ok(())
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
    let endpoint = format!("{}/v1/tools/vision_qa", worker_url.trim_end_matches('/'),);

    let part = reqwest::multipart::Part::bytes(image_png)
        .file_name("frame.png")
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

#[cfg(not(target_os = "linux"))]
fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
