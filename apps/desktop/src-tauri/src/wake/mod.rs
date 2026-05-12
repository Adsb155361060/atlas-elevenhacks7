//! Wake-word detection orchestrator.
//!
//! `livekit-wakeword` (pure-Rust ONNX via `ort-tract`, ADR 0019) + cpal mic
//! capture. The module is **graceful**: when the wake-classifier ONNX file
//! `resources/wake/hey_atlas.onnx` is missing, `start_if_configured` returns
//! `Ok(None)` and the app continues without wake detection.
//!
//! Until a real classifier file is in place, two fallbacks exercise the rest
//! of the loop:
//! - The debug-only `fire_wake_test` Tauri command (commands.rs).
//! - The global hotkey registered in Phase 0.G.

mod audio;
mod detector;
mod worker;

use anyhow::{Context, Result};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

use crate::state::{self, AtlasState, StateChannel};

/// Live wake-detection runtime. Held in Tauri's managed state so the worker
/// thread and pause-watcher stay alive for the app lifetime.
///
/// Note: `cpal::Stream` is `!Send` on Linux's ALSA backend, which would force
/// us to wrap it in a `Mutex` *and* prevent `Tauri::manage` from accepting it
/// (`Send + Sync` bound). The audio stream is meant to run for the entire app
/// lifetime, so we deliberately leak it via `mem::forget` inside
/// `start_if_configured`. The OS reclaims the device at process exit.
pub struct WakeHandle {
    // Kept on the struct so the future settings UI can toggle wake-detection
    // without going through a full `AtlasState::Paused` transition. The
    // state-watcher task also writes to it.
    #[allow(dead_code)]
    paused: Arc<AtomicBool>,
    _worker: worker::WorkerHandle,
}

impl WakeHandle {
    /// Toggle pause state directly. Normally the state-watcher task handles
    /// this in response to `AtlasState::Paused` transitions, but this is
    /// available for tests / future settings UI.
    #[allow(dead_code)]
    pub fn set_paused(&self, value: bool) {
        self.paused.store(value, Ordering::Relaxed);
    }
}

/// Start wake detection if a wakeword file is present. Logs a warning +
/// returns `Ok(None)` when the file is missing so the rest of the app
/// continues to boot.
pub fn start_if_configured<R: Runtime>(app: &AppHandle<R>) -> Result<Option<WakeHandle>> {
    let Some(wakeword_path) = resolve_wakeword_path() else {
        log::warn!(
            "wake disabled: no classifier at apps/desktop/src-tauri/resources/wake/hey_atlas.onnx (see README there). Use fire_wake_test in debug builds or the Phase 0.G hotkey."
        );
        return Ok(None);
    };

    log::info!(
        "wake: loading livekit-wakeword classifier from {}",
        wakeword_path.display()
    );
    let detector = detector::Detector::new(&wakeword_path).context("detector init")?;
    log::info!(
        "wake detector: sample_rate={} threshold={}",
        detector.sample_rate(),
        detector.threshold(),
    );

    let (tx, rx) = crossbeam_channel::bounded::<Vec<i16>>(128);
    let capture = audio::AudioCapture::start(tx).context("audio start")?;
    log::info!(
        "wake audio: device='{}' rate={} ch={}",
        capture.device_name(),
        capture.sample_rate(),
        capture.channels()
    );
    // Intentional leak — see WakeHandle doc. The `cpal::Stream` is `!Send` on
    // Linux ALSA; rather than thread-pin or Arc<Mutex<>>, we let it run for
    // the process lifetime. Audio device is released by the OS on exit.
    std::mem::forget(capture);

    let paused = Arc::new(AtomicBool::new(false));
    let worker = worker::spawn(app.clone(), detector, rx, paused.clone());

    spawn_pause_watcher(app, paused.clone());

    Ok(Some(WakeHandle {
        paused,
        _worker: worker,
    }))
}

fn resolve_wakeword_path() -> Option<PathBuf> {
    // Single cross-platform ONNX classifier — livekit-wakeword loads any
    // architecture-compatible `.onnx` produced by the LiveKit training kit.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/wake/hey_atlas.onnx");
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// Reflect `AtlasState::Paused` into the worker's atomic flag so wake
/// detection idles when the user pauses, without tearing down the audio
/// stream (which would re-cost device re-init latency on resume).
fn spawn_pause_watcher<R: Runtime>(app: &AppHandle<R>, paused: Arc<AtomicBool>) {
    let state_handle = app.state::<StateChannel>();
    let mut rx = state_handle.rx.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let current = *rx.borrow();
            let is_paused = matches!(current, AtlasState::Paused);
            paused.store(is_paused, Ordering::Relaxed);
            if rx.changed().await.is_err() {
                break;
            }
        }
        log::debug!("wake pause watcher exited");
    });
}

/// Debug-only entry point that simulates the wake event for end-to-end
/// development before a wakeword file is in place. Wired to the
/// `fire_wake_test` Tauri command behind `#[cfg(debug_assertions)]`.
pub fn fire_wake_test<R: Runtime>(app: &AppHandle<R>) {
    log::info!("wake: simulated wake (fire_wake_test)");
    use tauri::Emitter;
    let _ = app.emit("wake:fired", "test");
    if let Err(err) = state::set(app, AtlasState::Armed) {
        log::warn!("fire_wake_test: state transition failed: {err:#}");
    }
}
