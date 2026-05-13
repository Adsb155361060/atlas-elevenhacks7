//! Wake-word detector built on `livekit-wakeword` (ADR 0019).
//!
//! Different shape from a per-frame engine: livekit-wakeword runs inference on
//! a buffer of ~2 seconds and returns per-classifier scores. The worker
//! maintains a rolling buffer and calls `predict` periodically.

use anyhow::{anyhow, Context, Result};
use livekit_wakeword::wakeword::WakeWordModel;
use std::path::Path;

/// Sample rate we feed the model (matches cpal's downsampling target).
pub const SAMPLE_RATE: u32 = 16_000;
/// Default confidence threshold for a positive detection. Tune in Day-3 test.
pub const DEFAULT_THRESHOLD: f32 = 0.5;
/// Rolling buffer length to predict on, in samples (2.5s @ 16kHz). The model
/// needs ~2s minimum; we keep a bit more so we don't miss wake-words that
/// span a chunk boundary.
pub const ROLLING_BUFFER_SAMPLES: usize = (SAMPLE_RATE as usize) * 5 / 2;

pub struct Detector {
    inner: WakeWordModel,
    threshold: f32,
}

impl Detector {
    pub fn new(onnx_path: &Path) -> Result<Self> {
        let path = onnx_path
            .to_str()
            .with_context(|| format!("non-utf8 onnx path: {onnx_path:?}"))?;
        let inner = WakeWordModel::new(&[path], SAMPLE_RATE)
            .map_err(|e| anyhow!("livekit-wakeword init: {e}"))?;
        Ok(Self {
            inner,
            threshold: DEFAULT_THRESHOLD,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }

    pub fn threshold(&self) -> f32 {
        self.threshold
    }

    /// Run the rolling buffer through the model. Returns the highest-scoring
    /// wake-word above threshold, if any.
    pub fn predict(&mut self, samples: &[i16]) -> Option<(String, f32)> {
        let preds = match self.inner.predict(samples) {
            Ok(v) => v,
            Err(err) => {
                log::warn!("wake predict error: {err}");
                return None;
            }
        };
        preds
            .into_iter()
            .filter(|(_, score)| *score >= self.threshold)
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
    }
}
