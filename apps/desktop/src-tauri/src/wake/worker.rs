//! Wake-detection worker thread.
//!
//! Pulls callback-sized frames from the crossbeam channel produced by
//! `audio.rs`, maintains a 2.5-second rolling buffer at 16kHz, and runs
//! `livekit-wakeword` inference every ~200ms. On a positive detection above
//! threshold, fires the `wake:fired` Tauri event and transitions the global
//! state to `AtlasState::Armed`. A cooldown window suppresses duplicate
//! firings from overlapping inference windows.
//!
//! Runs on its own OS thread because ONNX inference is CPU-bound and we want
//! a scheduling context separate from the webview's async runtime.

use crossbeam_channel::{Receiver, RecvTimeoutError};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};

use super::detector::{Detector, ROLLING_BUFFER_SAMPLES, SAMPLE_RATE};
use crate::state::{self, AtlasState};

/// How often the worker runs an inference pass. 200ms = 5 hz; trades CPU for
/// detection latency. Re-tune in Phase 0.D Day-3.
const PREDICT_INTERVAL: Duration = Duration::from_millis(200);
/// Suppress duplicate firings within this window after a positive detection.
const COOLDOWN: Duration = Duration::from_millis(1500);
/// Minimum buffer length before we even attempt to predict. The model
/// silently returns 0.0 for shorter buffers, so guard up front.
const MIN_PREDICT_SAMPLES: usize = (SAMPLE_RATE as usize) * 2; // 2.0s

pub struct WorkerHandle {
    shutdown: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl WorkerHandle {
    /// Signal the worker to stop and wait for it to exit. Idempotent.
    pub fn stop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(handle) = self.thread.take() {
            if let Err(err) = handle.join() {
                log::warn!("wake worker join failed: {err:?}");
            }
        }
    }
}

impl Drop for WorkerHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn spawn<R: Runtime>(
    app: AppHandle<R>,
    detector: Detector,
    rx: Receiver<Vec<i16>>,
    paused: Arc<AtomicBool>,
) -> WorkerHandle {
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();
    let thread = std::thread::Builder::new()
        .name("atlas-wake".into())
        .spawn(move || run(app, detector, rx, shutdown_clone, paused))
        .expect("spawn atlas-wake thread");
    WorkerHandle {
        shutdown,
        thread: Some(thread),
    }
}

fn run<R: Runtime>(
    app: AppHandle<R>,
    mut detector: Detector,
    rx: Receiver<Vec<i16>>,
    shutdown: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
) {
    log::info!(
        "wake worker started (buffer={}s, interval={}ms, cooldown={}ms, threshold={})",
        ROLLING_BUFFER_SAMPLES as f32 / SAMPLE_RATE as f32,
        PREDICT_INTERVAL.as_millis(),
        COOLDOWN.as_millis(),
        detector.threshold(),
    );

    let mut ring: VecDeque<i16> = VecDeque::with_capacity(ROLLING_BUFFER_SAMPLES + 8_000);
    let mut last_predict = Instant::now() - PREDICT_INTERVAL;
    let mut last_detection: Option<Instant> = None;

    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(samples) => {
                if paused.load(Ordering::Relaxed) {
                    ring.clear();
                    continue;
                }
                ring.extend(samples);
                while ring.len() > ROLLING_BUFFER_SAMPLES {
                    ring.pop_front();
                }
                if ring.len() < MIN_PREDICT_SAMPLES {
                    continue;
                }

                let now = Instant::now();
                if now.duration_since(last_predict) < PREDICT_INTERVAL {
                    continue;
                }
                if let Some(t) = last_detection {
                    if now.duration_since(t) < COOLDOWN {
                        continue;
                    }
                }
                last_predict = now;

                // Snapshot the ring into a contiguous slice (VecDeque exposes
                // two slices; reconstruct via `make_contiguous`).
                let buf: &[i16] = ring.make_contiguous();
                if let Some((name, score)) = detector.predict(buf) {
                    last_detection = Some(now);
                    log::info!("wake: '{name}' detected (score={score:.3})");
                    let _ = app.emit("wake:fired", &name);
                    if let Err(err) = state::set(&app, AtlasState::Armed) {
                        log::warn!("wake: state transition failed: {err:#}");
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                log::info!("wake: audio channel closed; exiting worker");
                break;
            }
        }
    }
    log::info!("wake worker exited");
}
