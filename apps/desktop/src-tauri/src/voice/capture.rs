//! Microphone capture for the voice loop.
//!
//! Strategy: open a cpal default-input stream as soon as the voice module
//! starts (typically wake-fire → session-start), capture i16 mono PCM, mix &
//! decimate to 16kHz when needed, accumulate into 250ms chunks (4000 samples),
//! and forward to the WebSocket client via a tokio mpsc.
//!
//! When the voice loop isn't in `Listening`/`Armed`, the orchestrator gates
//! the chunks at the client layer — we keep capturing rather than tear down
//! the audio device, because cpal init latency is ~50-200ms and we'd blow the
//! "wake fired → mic streaming" sub-200ms budget.

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use parking_lot::Mutex;
use std::sync::Arc;
use tokio::sync::mpsc::UnboundedSender;

use super::client::ClientCommand;

/// Sample rate the ElevenLabs Conversational Agent expects for input audio.
pub const TARGET_SAMPLE_RATE: u32 = 16_000;
/// Bytes per i16 sample.
pub const BYTES_PER_SAMPLE: usize = 2;
/// Recommended chunk size in samples — 250ms at 16kHz per the Python SDK
/// reference implementation (DefaultAudioInterface.INPUT_FRAMES_PER_BUFFER).
pub const SAMPLES_PER_CHUNK: usize = 4_000;

/// Live mic capture pinned to the agent session lifetime. The `cpal::Stream`
/// inside is `!Send` on Linux ALSA; callers should `mem::forget` the struct
/// (the orchestrator does this) so the stream stays alive without violating
/// the `Send + Sync` bound on Tauri-managed state.
pub struct AgentCapture {
    _stream: Stream,
    device_name: String,
    actual_sample_rate: u32,
    /// Shared accumulator — the cpal callback pushes samples in, and emits a
    /// chunk to the client when `SAMPLES_PER_CHUNK` is reached.
    _accumulator: Arc<Mutex<Vec<i16>>>,
}

impl AgentCapture {
    pub fn start(tx: UnboundedSender<ClientCommand>) -> Result<Self> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| anyhow!("no default audio input device"))?;
        let device_name = device.name().unwrap_or_else(|_| "unknown".into());

        let (config, sample_format) = pick_input_config(&device)?;
        let sample_rate = config.sample_rate.0;
        let channels = config.channels as usize;

        let downsample = if sample_rate >= TARGET_SAMPLE_RATE {
            sample_rate / TARGET_SAMPLE_RATE
        } else {
            1
        };

        log::info!(
            "voice/capture: device='{device_name}' rate={sample_rate} ch={channels} fmt={sample_format:?}"
        );

        let accumulator: Arc<Mutex<Vec<i16>>> =
            Arc::new(Mutex::new(Vec::with_capacity(SAMPLES_PER_CHUNK * 2)));

        let err_fn = |e| log::error!("voice/capture: stream error: {e}");

        let stream = match sample_format {
            SampleFormat::I16 => {
                let acc = accumulator.clone();
                let tx = tx.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        let mono = mix_to_mono_i16(data, channels);
                        let down = decimate(&mono, downsample);
                        accumulate(&acc, &down, &tx);
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::F32 => {
                let acc = accumulator.clone();
                let tx = tx.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[f32], _| {
                        let mono = mix_to_mono_f32_as_i16(data, channels);
                        let down = decimate(&mono, downsample);
                        accumulate(&acc, &down, &tx);
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::U16 => {
                let acc = accumulator.clone();
                let tx = tx.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[u16], _| {
                        let i16_buf: Vec<i16> = data.iter().map(|&u| u16_to_i16(u)).collect();
                        let mono = mix_to_mono_i16(&i16_buf, channels);
                        let down = decimate(&mono, downsample);
                        accumulate(&acc, &down, &tx);
                    },
                    err_fn,
                    None,
                )
            }
            other => return Err(anyhow!("unsupported sample format: {other:?}")),
        }
        .context("build_input_stream")?;

        stream.play().context("stream.play")?;

        Ok(Self {
            _stream: stream,
            device_name,
            actual_sample_rate: sample_rate,
            _accumulator: accumulator,
        })
    }

    pub fn device_name(&self) -> &str {
        &self.device_name
    }

    pub fn sample_rate(&self) -> u32 {
        self.actual_sample_rate
    }
}

/// Accumulate `chunk` into the shared buffer; when ≥ `SAMPLES_PER_CHUNK`
/// samples are present, drain one chunk's worth, base64-encode the PCM bytes,
/// and push a `ClientCommand::SendUserAudio` to the WebSocket task. Locks are
/// held only for the time it takes to copy bytes — microseconds; cpal's
/// callback thread is robust to that.
fn accumulate(
    acc: &Arc<Mutex<Vec<i16>>>,
    chunk: &[i16],
    tx: &UnboundedSender<ClientCommand>,
) {
    let mut buf = acc.lock();
    buf.extend_from_slice(chunk);
    while buf.len() >= SAMPLES_PER_CHUNK {
        let drained: Vec<i16> = buf.drain(..SAMPLES_PER_CHUNK).collect();
        // PCM16 little-endian → bytes
        let mut bytes = Vec::with_capacity(drained.len() * BYTES_PER_SAMPLE);
        for sample in drained {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        let b64 = STANDARD.encode(&bytes);
        if tx.send(ClientCommand::SendUserAudio(b64)).is_err() {
            // Client has shut down; drop subsequent samples silently.
            buf.clear();
            return;
        }
    }
}

// ───────────────────────── config selection ─────────────────────────

fn pick_input_config(device: &Device) -> Result<(StreamConfig, SampleFormat)> {
    if let Ok(supported) = device.supported_input_configs() {
        let supported: Vec<_> = supported.collect();
        for sc in &supported {
            if sc.channels() == 1
                && sc.min_sample_rate().0 <= TARGET_SAMPLE_RATE
                && sc.max_sample_rate().0 >= TARGET_SAMPLE_RATE
            {
                let chosen = sc.with_sample_rate(cpal::SampleRate(TARGET_SAMPLE_RATE));
                return Ok((chosen.config(), chosen.sample_format()));
            }
        }
    }
    let default = device
        .default_input_config()
        .context("default_input_config")?;
    Ok((default.config(), default.sample_format()))
}

// ───────────────────────── conversions ─────────────────────────

fn mix_to_mono_i16(data: &[i16], channels: usize) -> Vec<i16> {
    if channels <= 1 {
        return data.to_vec();
    }
    data.chunks(channels)
        .map(|c| {
            let sum: i32 = c.iter().map(|&s| s as i32).sum();
            (sum / c.len() as i32) as i16
        })
        .collect()
}

fn mix_to_mono_f32_as_i16(data: &[f32], channels: usize) -> Vec<i16> {
    if channels <= 1 {
        return data.iter().map(f32_to_i16).collect();
    }
    data.chunks(channels)
        .map(|c| {
            let avg = c.iter().copied().sum::<f32>() / c.len() as f32;
            f32_to_i16(&avg)
        })
        .collect()
}

fn decimate(samples: &[i16], factor: u32) -> Vec<i16> {
    if factor <= 1 {
        return samples.to_vec();
    }
    let factor = factor as usize;
    let mut out = Vec::with_capacity(samples.len() / factor + 1);
    for window in samples.chunks(factor) {
        let sum: i32 = window.iter().map(|&s| s as i32).sum();
        out.push((sum / window.len() as i32) as i16);
    }
    out
}

fn f32_to_i16(s: &f32) -> i16 {
    let clamped = s.clamp(-1.0, 1.0);
    (clamped * f32::from(i16::MAX)) as i16
}

fn u16_to_i16(u: u16) -> i16 {
    (u as i32 - 32768) as i16
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    #[test]
    fn accumulate_emits_chunk_at_boundary() {
        let (tx, mut rx) = unbounded_channel::<ClientCommand>();
        let acc: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));

        // Push less than a chunk — nothing emitted.
        accumulate(&acc, &vec![0_i16; 1000], &tx);
        assert!(rx.try_recv().is_err());

        // Push enough to cross the boundary — one chunk emitted.
        accumulate(&acc, &vec![0_i16; SAMPLES_PER_CHUNK], &tx);
        let cmd = rx.try_recv().expect("chunk after boundary");
        match cmd {
            ClientCommand::SendUserAudio(b64) => {
                // base64 of 8000 bytes = 10668 chars (8000*4/3 rounded up to multiple of 4)
                // Each i16 sample is 2 bytes, SAMPLES_PER_CHUNK=4000 → 8000 bytes.
                assert!(b64.len() > 10_000);
            }
            other => panic!("unexpected command: {other:?}"),
        }
        // Residual: started with 1000, added 4000 = 5000, drained 4000 → 1000 left.
        assert_eq!(acc.lock().len(), 1000);
    }

    #[test]
    fn decimate_factor_3_box_filter() {
        let data: Vec<i16> = vec![3, 3, 3, 6, 6, 6, 9, 9, 9];
        assert_eq!(decimate(&data, 3), vec![3, 6, 9]);
    }
}
