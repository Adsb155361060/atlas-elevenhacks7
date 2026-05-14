//! Tauri command surface exposed to the React frontend.
//!
//! Keep these thin — actual logic lives in the backend modules.

use crate::state::{self, AtlasState};
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub fn get_state<R: Runtime>(app: AppHandle<R>) -> String {
    state::current(&app).as_str().to_string()
}

#[tauri::command]
pub fn set_state<R: Runtime>(app: AppHandle<R>, value: String) -> Result<(), String> {
    let parsed =
        AtlasState::parse(&value).ok_or_else(|| format!("unknown atlas state: {value:?}"))?;
    state::set(&app, parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_main_window<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn hide_main_window<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn quit_app<R: Runtime>(app: AppHandle<R>) {
    log::info!("quit_app invoked from frontend");
    app.exit(0);
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Read the tail of the active log file so the frontend's "Copy diagnostics"
/// button can ship a self-contained bug report to clipboard. We deliberately
/// cap the returned size — log files can be large after a long-running
/// session and we don't want to OOM the WebView when the user clicks.
#[tauri::command]
pub fn copy_diagnostics<R: Runtime>(app: AppHandle<R>, lines: Option<usize>) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;
    let max_lines = lines.unwrap_or(120).min(2000);
    let log_dir: PathBuf = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("could not resolve log dir: {e}"))?;
    // tauri-plugin-log writes "atlas.log" (current) plus rotated siblings.
    let primary = log_dir.join("atlas.log");
    if !primary.exists() {
        return Err(format!("no log file at {}", primary.display()));
    }
    let content = fs::read_to_string(&primary)
        .map_err(|e| format!("read {} failed: {e}", primary.display()))?;
    let tail: Vec<&str> = content.lines().rev().take(max_lines).collect();
    let mut out = String::new();
    for line in tail.into_iter().rev() {
        out.push_str(line);
        out.push('\n');
    }
    Ok(out)
}

/// Open the OS-level microphone privacy settings page. On Windows that
/// deep-links into the Privacy → Microphone settings; on macOS, the
/// Security & Privacy → Microphone pane. Linux falls back to logging a
/// hint since the URI mechanism isn't standardized across DEs.
#[tauri::command]
pub fn open_mic_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "ms-settings:privacy-microphone"])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        log::info!("open_mic_settings: not implemented on this OS — open your system's privacy panel manually");
        Ok(())
    }
}

#[derive(serde::Serialize)]
pub struct AppInfo {
    pub version: String,
    pub target_os: String,
    pub target_arch: String,
    pub debug: bool,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        target_os: std::env::consts::OS.to_string(),
        target_arch: std::env::consts::ARCH.to_string(),
        debug: cfg!(debug_assertions),
    }
}

/// Wipe voice prefs, audit log marker (Phase 14 lands the real log), and
/// reset onboarding so the user lands back in the wizard. Does **not** touch
/// remote-side artifacts (cloned voices on ElevenLabs, conversation history
/// on their dashboard) — surface those instructions to the user separately.
#[tauri::command]
pub fn settings_reset_all_data<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    crate::voice::preferences::reset(&app).map_err(|e| e.to_string())?;
    crate::voice::memory::clear(&app).map_err(|e| e.to_string())?;
    // Best-effort: close any in-flight voice session so it doesn't keep using
    // the now-stale voice_id.
    if let Some(voice) = app.try_state::<crate::voice::VoiceHandle>() {
        voice.send_command(crate::voice::ClientCommand::Close);
    }
    log::info!("settings: all local data reset");
    Ok(())
}

/// Debug-only: simulate the wake event so the rest of the voice loop can be
/// Manually fire a wake event. Originally a debug-only helper, but it's also
/// the fallback path on platforms where global hotkeys can't be intercepted
/// (e.g. Wayland compositors that block XGrabKey) — the cockpit click-handler
/// invokes this so users can wake Atlas by tapping the orb / window.
#[tauri::command]
pub fn fire_wake_test<R: Runtime>(app: AppHandle<R>) {
    crate::wake::fire_wake_externally(&app);
}

/// Toggle visibility of the mini overlay window (Phase 0.G).
#[tauri::command]
pub fn toggle_mini_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    crate::mini::toggle(&app).map_err(|e| e.to_string())
}

/// Frontend delivers a camera frame back to the vision bridge. Called in
/// response to the `atlas:vision:capture_camera` event emitted by
/// `vision_qa::capture_camera`.
#[tauri::command]
pub fn vision_camera_deliver<R: Runtime>(
    _app: AppHandle<R>,
    request_id: String,
    base64_png: String,
) -> Result<(), String> {
    crate::tools::vision_qa::deliver_camera_capture(&request_id, &base64_png)
        .map_err(|e| e.to_string())
}

/// Debug-only: queue a `user_message` text frame into the active voice
/// session. Useful for testing the agent loop without speaking.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn send_user_message_test<R: Runtime>(app: AppHandle<R>, text: String) {
    crate::voice::send_test_user_message(&app, &text);
}

// ───────────────────────── voice prefs / onboarding (Phase 0.F) ─────────────────────────

#[tauri::command]
pub fn voice_prefs_get<R: Runtime>(
    app: AppHandle<R>,
) -> Result<crate::voice::preferences::VoicePreferences, String> {
    crate::voice::preferences::read(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voice_prefs_set<R: Runtime>(
    app: AppHandle<R>,
    voice_id: String,
    voice_name: String,
    source: String,
) -> Result<(), String> {
    crate::voice::preferences::write_voice(&app, &voice_id, &voice_name, &source)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voice_onboarding_complete<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    crate::voice::preferences::mark_onboarding_complete(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voice_prefs_reset<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    crate::voice::preferences::reset(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_list_stock(
    query: Option<String>,
) -> Result<crate::voice::ivc::VoiceList, String> {
    crate::voice::ivc::list_voices(query.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Record `seconds` of mic audio for IVC, then upload it to the worker.
/// Returns `{voice_id, requires_verification}` from ElevenLabs. Persists the
/// voice id to preferences as `voice.source=cloned_record`.
#[tauri::command]
pub async fn voice_record_and_clone<R: Runtime>(
    app: AppHandle<R>,
    seconds: u32,
    voice_name: String,
) -> Result<crate::voice::ivc::CloneResult, String> {
    use std::time::Duration;
    let duration = Duration::from_secs(u64::from(seconds));
    let wav = tauri::async_runtime::spawn_blocking(move || {
        crate::voice::ivc::record_wav_blocking(duration)
    })
    .await
    .map_err(|e| format!("record task join: {e}"))?
    .map_err(|e| e.to_string())?;

    let filename = format!("{}.wav", sanitize_for_filename(&voice_name));
    let result = crate::voice::ivc::upload_clone(wav, &filename, &voice_name, None)
        .await
        .map_err(|e| e.to_string())?;
    crate::voice::preferences::write_voice(&app, &result.voice_id, &voice_name, "cloned_record")
        .map_err(|e| e.to_string())?;
    Ok(result)
}

/// Upload an arbitrary audio blob already in memory (e.g. a user-provided
/// WAV/MP3 file the frontend read via plugin-fs) and clone the voice.
#[tauri::command]
pub async fn voice_upload_and_clone<R: Runtime>(
    app: AppHandle<R>,
    bytes: Vec<u8>,
    filename: String,
    voice_name: String,
) -> Result<crate::voice::ivc::CloneResult, String> {
    let result = crate::voice::ivc::upload_clone(bytes, &filename, &voice_name, None)
        .await
        .map_err(|e| e.to_string())?;
    crate::voice::preferences::write_voice(&app, &result.voice_id, &voice_name, "cloned_upload")
        .map_err(|e| e.to_string())?;
    Ok(result)
}

fn sanitize_for_filename(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
