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
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// Open the mic stream. While `mute_flag` is `true`, captured frames are
    /// replaced with silence before being chunked + sent upstream. This is how
    /// we implement half-duplex: when the agent is talking, ElevenLabs only
    /// receives zero PCM from us, so its VAD can't false-trigger on the
    /// agent's own voice bleeding through speakers / mic loopback / etc.
    pub fn start(
        tx: UnboundedSender<ClientCommand>,
        mute_flag: Arc<AtomicBool>,
    ) -> Result<Self> {
        let host = cpal::default_host();
        let device = pick_input_device(&host)?;
        let device_name = device.name().unwrap_or_else(|_| "unknown".into());

        let (config, sample_format) = pick_input_config(&device)?;
        let sample_rate = config.sample_rate.0;
        let channels = config.channels as usize;

        if sample_rate != TARGET_SAMPLE_RATE {
            log::info!(
                "voice/capture: device rate {sample_rate}Hz != target {TARGET_SAMPLE_RATE}Hz — resampling each frame"
            );
        }

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
                let muted = mute_flag.clone();
                let mut resampler = Resampler::new(sample_rate, TARGET_SAMPLE_RATE);
                device.build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        let mono = mix_to_mono_i16(data, channels);
                        let down = resampler.process(&mono);
                        accumulate(&acc, &down, &tx, &muted);
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::F32 => {
                let acc = accumulator.clone();
                let tx = tx.clone();
                let muted = mute_flag.clone();
                let mut resampler = Resampler::new(sample_rate, TARGET_SAMPLE_RATE);
                device.build_input_stream(
                    &config,
                    move |data: &[f32], _| {
                        let mono = mix_to_mono_f32_as_i16(data, channels);
                        let down = resampler.process(&mono);
                        accumulate(&acc, &down, &tx, &muted);
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::U16 => {
                let acc = accumulator.clone();
                let tx = tx.clone();
                let muted = mute_flag.clone();
                let mut resampler = Resampler::new(sample_rate, TARGET_SAMPLE_RATE);
                device.build_input_stream(
                    &config,
                    move |data: &[u16], _| {
                        let i16_buf: Vec<i16> = data.iter().map(|&u| u16_to_i16(u)).collect();
                        let mono = mix_to_mono_i16(&i16_buf, channels);
                        let down = resampler.process(&mono);
                        accumulate(&acc, &down, &tx, &muted);
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::U8 => {
                let acc = accumulator.clone();
                let tx = tx.clone();
                let muted = mute_flag.clone();
                let mut resampler = Resampler::new(sample_rate, TARGET_SAMPLE_RATE);
                device.build_input_stream(
                    &config,
                    move |data: &[u8], _| {
                        // u8 PCM: silence is 128, range 0..255 → recentre + scale to i16.
                        let i16_buf: Vec<i16> =
                            data.iter().map(|&u| ((u as i16) - 128) << 8).collect();
                        let mono = mix_to_mono_i16(&i16_buf, channels);
                        let down = resampler.process(&mono);
                        accumulate(&acc, &down, &tx, &muted);
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
    muted: &Arc<AtomicBool>,
) {
    let mut buf = acc.lock();
    if muted.load(Ordering::Relaxed) {
        // Half-duplex: while the agent is playing audio, replace incoming
        // mic samples with silence. The WebSocket stays alive (ElevenLabs
        // expects continuous PCM) but its VAD sees zeros and can't false-
        // trigger on the agent's own voice bleeding back through speaker
        // → mic, PipeWire monitor sources, etc.
        let new_len = buf.len() + chunk.len();
        buf.resize(new_len, 0);
    } else {
        buf.extend_from_slice(chunk);
    }
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

// ───────────────────────── device selection ──────────────────────────
//
// On a fresh Windows 11 box with mic permission set to "Allow desktop apps"
// the default input device is present and `default_input_device()` returns
// Some(...). But when the permission is **denied**, cpal's WASAPI backend
// returns None — same as if the laptop had no mic. We try a couple of
// fallbacks before giving up, and log every input device we saw so the log
// file makes it obvious whether the device list is empty (no mic / no
// permission) vs. just the "default" being unset.
fn pick_input_device(host: &cpal::Host) -> Result<Device> {
    if let Some(dev) = host.default_input_device() {
        if let Ok(name) = dev.name() {
            log::info!("voice/capture: using default input device '{name}'");
        }
        return Ok(dev);
    }

    log::warn!(
        "voice/capture: cpal default_input_device() returned None — falling back to enumerated list"
    );
    let mut tried: Vec<String> = Vec::new();
    if let Ok(devices) = host.input_devices() {
        for dev in devices {
            let name = dev.name().unwrap_or_else(|_| "(unnamed)".into());
            tried.push(name.clone());
            if dev.default_input_config().is_ok() {
                log::info!("voice/capture: fallback to input device '{name}'");
                return Ok(dev);
            }
        }
    }

    if tried.is_empty() {
        Err(anyhow!(
            "no audio input devices visible to the process — on Windows, check Settings → Privacy & security → Microphone → 'Let desktop apps access your microphone'"
        ))
    } else {
        Err(anyhow!(
            "no usable audio input device (saw: {}) — check OS mic permission",
            tried.join(", ")
        ))
    }
}

// ───────────────────────── config selection ─────────────────────────

fn pick_input_config(device: &Device) -> Result<(StreamConfig, SampleFormat)> {
    fn format_score(f: SampleFormat) -> u8 {
        match f {
            SampleFormat::I16 => 4,
            SampleFormat::F32 => 3,
            SampleFormat::U16 => 2,
            SampleFormat::U8 => 1,
            _ => 0,
        }
    }
    if let Ok(supported) = device.supported_input_configs() {
        let supported: Vec<_> = supported.collect();
        let candidate = supported
            .iter()
            .filter(|sc| {
                sc.min_sample_rate().0 <= TARGET_SAMPLE_RATE
                    && sc.max_sample_rate().0 >= TARGET_SAMPLE_RATE
            })
            .max_by_key(|sc| {
                let mono_bonus = if sc.channels() == 1 { 10 } else { 0 };
                mono_bonus + format_score(sc.sample_format()) as i32
            });
        if let Some(sc) = candidate {
            let chosen = sc.with_sample_rate(cpal::SampleRate(TARGET_SAMPLE_RATE));
            return Ok((chosen.config(), chosen.sample_format()));
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

/// Streaming linear resampler, mono i16. The old code did integer
/// `decimate(rate / 16000)` which only lands on exactly 16 kHz when the
/// device rate is an integer multiple — true for 48 kHz (the usual Windows
/// WASAPI / macOS CoreAudio default) but *not* for 44.1 kHz, where
/// `44100 / 16000 == 2` produced 22.05 kHz audio that we then mislabeled as
/// 16 kHz, so ElevenLabs heard the user pitched-down and slow → ASR failed.
/// Linear interpolation handles any `src_rate → dst_rate` ratio. State
/// (`pos`, `prev`) carries across cpal callbacks so chunk seams don't click.
struct Resampler {
    src_rate: u32,
    dst_rate: u32,
    pos: f64,
    prev: i16,
}

impl Resampler {
    fn new(src_rate: u32, dst_rate: u32) -> Self {
        Self {
            src_rate,
            dst_rate,
            pos: 0.0,
            prev: 0,
        }
    }

    fn process(&mut self, chunk: &[i16]) -> Vec<i16> {
        if chunk.is_empty() {
            return Vec::new();
        }
        // Fast path: device already at target rate (Linux ALSA `default`).
        if self.src_rate == self.dst_rate {
            return chunk.to_vec();
        }
        // Virtual input `v` has length chunk.len()+1: v[0] = prev (last sample
        // of the previous chunk), v[k] = chunk[k-1].
        let step = self.src_rate as f64 / self.dst_rate as f64;
        let n = chunk.len();
        let prev = self.prev;
        let get = |i: usize| -> f64 {
            if i == 0 {
                prev as f64
            } else {
                chunk[i - 1] as f64
            }
        };
        let mut out = Vec::with_capacity(((n as f64) / step) as usize + 1);
        while self.pos < n as f64 {
            let i0 = self.pos.floor() as usize;
            let frac = self.pos - i0 as f64;
            let a = get(i0);
            let b = get(i0 + 1);
            let s = a + (b - a) * frac;
            out.push(s.round().clamp(i16::MIN as f64, i16::MAX as f64) as i16);
            self.pos += step;
        }
        // Shift the frame: next chunk's index 0 is this chunk's last sample.
        self.pos -= n as f64;
        self.prev = chunk[n - 1];
        out
    }
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
        let muted = Arc::new(AtomicBool::new(false));

        // Push less than a chunk — nothing emitted.
        accumulate(&acc, &vec![123_i16; 1000], &tx, &muted);
        assert!(rx.try_recv().is_err());

        // Push enough to cross the boundary — one chunk emitted.
        accumulate(&acc, &vec![123_i16; SAMPLES_PER_CHUNK], &tx, &muted);
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
    fn accumulate_writes_silence_when_muted() {
        let (tx, mut rx) = unbounded_channel::<ClientCommand>();
        let acc: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));
        let muted = Arc::new(AtomicBool::new(true));

        // Even loud samples become silence when muted.
        accumulate(&acc, &vec![i16::MAX; SAMPLES_PER_CHUNK], &tx, &muted);
        let cmd = rx.try_recv().expect("chunk after boundary");
        if let ClientCommand::SendUserAudio(b64) = cmd {
            let raw = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
            assert!(raw.iter().all(|&b| b == 0), "muted chunk should be all zeros");
        } else {
            panic!("expected SendUserAudio");
        }
    }

    #[test]
    fn resampler_identity_when_rates_match() {
        let mut r = Resampler::new(16_000, 16_000);
        let data: Vec<i16> = vec![3, -7, 100, 9];
        assert_eq!(r.process(&data), data);
    }

    #[test]
    fn resampler_48k_to_16k_thirds_the_rate() {
        let mut r = Resampler::new(48_000, 16_000);
        // 300 input samples of a constant value → ~100 output samples, and
        // (interpolating between equal points) every steady-state sample
        // equals the input level.
        let input = vec![1234_i16; 300];
        let out = r.process(&input);
        assert!(
            (98..=102).contains(&out.len()),
            "expected ~100 samples, got {}",
            out.len()
        );
        assert_eq!(out[50], 1234);
    }

    #[test]
    fn resampler_44100_to_16k_is_not_integer_decimation() {
        // The bug this replaces: 44100 / 16000 == 2 (integer), so the old
        // code produced 22050 Hz. The resampler must produce ~16000/44100 of
        // the input, i.e. clearly fewer than the old "half" would.
        let mut r = Resampler::new(44_100, 16_000);
        let out = r.process(&vec![0_i16; 44_100]);
        // 44100 @ 44.1k → ~16000 @ 16k. Old decimate(2) gave 22050.
        assert!(
            (15_900..=16_100).contains(&out.len()),
            "expected ~16000 samples, got {}",
            out.len()
        );
    }
}
