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
    let parsed = AtlasState::parse(&value)
        .ok_or_else(|| format!("unknown atlas state: {value:?}"))?;
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

/// Debug-only: simulate the wake event so the rest of the voice loop can be
/// exercised before a wakeword model is configured. Wired in `lib.rs` only
/// when `debug_assertions` is on, so it's stripped from release builds.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn fire_wake_test<R: Runtime>(app: AppHandle<R>) {
    crate::wake::fire_wake_test(&app);
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
