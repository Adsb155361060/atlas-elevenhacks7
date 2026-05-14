//! Agent audio playback.
//!
//! cpal default-output stream consumes from a `VecDeque<i16>` ring buffer.
//! The WebSocket task pushes decoded PCM into the ring as `audio` events
//! arrive; the cpal callback pulls samples each tick and writes them out. An
//! `interrupt()` clears the ring, mirroring the Python SDK's behavior (which
//! drains its output queue on user interruption).
//!
//! The agent's output sample-rate is reported in `conversation_initiation_metadata`
//! as e.g. `pcm_16000`. We parse that, configure the cpal output stream at
//! that rate, and re-init the stream if the rate ever changes between sessions.

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Streaming linear-resampler state. The agent always sends `agent_sample_rate`
/// PCM (16 kHz); the cpal device may run at a different rate (48 kHz is typical
/// on macOS/Windows). We resample each incoming chunk on the WS thread before
/// it lands in the ring, so the realtime audio callback stays a 1:1 consumer.
/// `pos` is the fractional read cursor into the *next* chunk (carried across
/// chunk boundaries); `prev` is the last sample of the previous chunk, used as
/// the left interpolation neighbour for samples that fall before chunk[0].
struct ResampleState {
    pos: f64,
    prev: i16,
}

/// Shared playback handle. Cheap to clone (Arc internally). The cpal stream
/// itself is `!Send` on Linux; we keep it inside a `Mutex<Option<Stream>>`
/// guarded behind this handle.
#[derive(Clone)]
pub struct PlaybackHandle {
    ring: Arc<Mutex<VecDeque<i16>>>,
    /// Event id of the most recent server-side interruption. Audio chunks
    /// arriving with an `event_id <= last_interrupt_id` are dropped (matches
    /// the Python SDK contract).
    last_interrupt_id: Arc<AtomicU64>,
    /// Rate the cpal output stream actually runs at — the ring holds samples
    /// at this rate.
    output_sample_rate: u32,
    /// Rate the agent sends PCM at (16 kHz). When it differs from
    /// `output_sample_rate` we resample on push.
    agent_sample_rate: u32,
    resampler: Arc<Mutex<ResampleState>>,
}

impl PlaybackHandle {
    /// Push raw PCM16 little-endian bytes into the ring. Called by the WS
    /// receiver after decoding `audio_event.audio_base_64`. When the device
    /// rate differs from the agent rate the chunk is linearly resampled here
    /// so the cpal callback can stay a plain 1:1 consumer.
    pub fn push_pcm16_le(&self, bytes: &[u8]) {
        // Decode pairs of LE bytes; tolerate an odd trailing byte by ignoring it.
        let chunk: Vec<i16> = bytes
            .chunks_exact(2)
            .map(|p| i16::from_le_bytes([p[0], p[1]]))
            .collect();
        if chunk.is_empty() {
            return;
        }

        let mut ring = self.ring.lock();

        // Fast path: rates match (e.g. Linux ALSA `default` opens at 16 kHz).
        if self.agent_sample_rate == self.output_sample_rate {
            ring.reserve(chunk.len());
            ring.extend(chunk.iter().copied());
            return;
        }

        // Streaming linear interpolation. Virtual input array `v` has length
        // chunk.len()+1: v[0] = prev (carried from last chunk), v[k] = chunk[k-1].
        let step = self.agent_sample_rate as f64 / self.output_sample_rate as f64;
        let mut rs = self.resampler.lock();
        let n = chunk.len();
        // `prev` is fixed for the whole chunk — copy it out so the closure
        // doesn't hold an immutable borrow of `rs` across `rs.pos` writes.
        let prev = rs.prev;
        let get = |i: usize| -> f64 {
            if i == 0 {
                prev as f64
            } else {
                chunk[i - 1] as f64
            }
        };
        // Rough output-sample estimate keeps the ring from re-allocating chunk-by-chunk.
        ring.reserve(((n as f64) / step) as usize + 1);
        while rs.pos < n as f64 {
            let i0 = rs.pos.floor() as usize;
            let frac = rs.pos - i0 as f64;
            let a = get(i0);
            let b = get(i0 + 1);
            let s = a + (b - a) * frac;
            ring.push_back(s.round().clamp(i16::MIN as f64, i16::MAX as f64) as i16);
            rs.pos += step;
        }
        // Shift the frame: next chunk's index 0 is this chunk's last sample.
        rs.pos -= n as f64;
        rs.prev = chunk[n - 1];
    }

    /// Decode a base64-encoded PCM16-LE blob and enqueue.
    pub fn push_base64(&self, base64_pcm: &str) -> Result<()> {
        let bytes = STANDARD
            .decode(base64_pcm.as_bytes())
            .context("base64 decode audio_base_64")?;
        self.push_pcm16_le(&bytes);
        Ok(())
    }

    /// True if this audio event id is older than or equal to the latest
    /// interruption — caller should drop the chunk.
    pub fn is_audio_stale(&self, event_id: u64) -> bool {
        event_id <= self.last_interrupt_id.load(Ordering::Acquire)
    }

    /// Clear pending audio and record the interruption id. Subsequent audio
    /// chunks with `event_id <= id` will be filtered by `is_audio_stale`.
    pub fn interrupt(&self, interrupt_event_id: u64) {
        self.last_interrupt_id
            .store(interrupt_event_id, Ordering::Release);
        self.ring.lock().clear();
        log::debug!("voice/playback: interrupted at event_id={interrupt_event_id}");
    }

    pub fn output_sample_rate(&self) -> u32 {
        self.output_sample_rate
    }

    /// Samples currently queued for playback. The half-duplex watcher in
    /// `voice/mod.rs` polls this to decide when to mute / unmute the mic.
    pub fn pending_samples(&self) -> usize {
        self.ring.lock().len()
    }
}

/// Live cpal output stream + the shared `PlaybackHandle`. As with capture,
/// callers should `mem::forget` the `Playback` struct so the `!Send` stream
/// survives the orchestrator's bookkeeping.
pub struct Playback {
    _stream: Stream,
    handle: PlaybackHandle,
    device_name: String,
}

impl Playback {
    /// Open a cpal output stream at `sample_rate` Hz (mono i16).
    pub fn start(sample_rate: u32) -> Result<Self> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| anyhow!("no default audio output device"))?;
        let device_name = device.name().unwrap_or_else(|_| "unknown".into());

        let (config, sample_format) = pick_output_config(&device, sample_rate)?;
        let device_rate = config.sample_rate.0;
        if device_rate != sample_rate {
            log::info!(
                "voice/playback: device rate {device_rate}Hz != agent rate {sample_rate}Hz — resampling on push"
            );
        }
        log::info!(
            "voice/playback: device='{device_name}' rate={device_rate} ch={} fmt={sample_format:?}",
            config.channels
        );

        let ring: Arc<Mutex<VecDeque<i16>>> = Arc::new(Mutex::new(VecDeque::with_capacity(
            device_rate as usize, // ~1 second of buffering capacity
        )));
        let last_interrupt_id = Arc::new(AtomicU64::new(0));

        let err_fn = |e| log::error!("voice/playback: stream error: {e}");
        let channels = config.channels as usize;

        let stream = match sample_format {
            SampleFormat::I16 => {
                let ring = ring.clone();
                device.build_output_stream(
                    &config,
                    move |data: &mut [i16], _| fill_i16(data, channels, &ring),
                    err_fn,
                    None,
                )
            }
            SampleFormat::F32 => {
                let ring = ring.clone();
                device.build_output_stream(
                    &config,
                    move |data: &mut [f32], _| fill_f32(data, channels, &ring),
                    err_fn,
                    None,
                )
            }
            SampleFormat::U16 => {
                let ring = ring.clone();
                device.build_output_stream(
                    &config,
                    move |data: &mut [u16], _| fill_u16(data, channels, &ring),
                    err_fn,
                    None,
                )
            }
            SampleFormat::U8 => {
                let ring = ring.clone();
                device.build_output_stream(
                    &config,
                    move |data: &mut [u8], _| fill_u8(data, channels, &ring),
                    err_fn,
                    None,
                )
            }
            other => return Err(anyhow!("unsupported output sample format: {other:?}")),
        }
        .context("build_output_stream")?;

        stream.play().context("stream.play")?;

        Ok(Self {
            _stream: stream,
            handle: PlaybackHandle {
                ring,
                last_interrupt_id,
                output_sample_rate: device_rate,
                agent_sample_rate: sample_rate,
                resampler: Arc::new(Mutex::new(ResampleState { pos: 0.0, prev: 0 })),
            },
            device_name,
        })
    }

    pub fn handle(&self) -> PlaybackHandle {
        self.handle.clone()
    }

    pub fn device_name(&self) -> &str {
        &self.device_name
    }
}

// ───────────────────────── output callbacks ─────────────────────────

fn fill_i16(data: &mut [i16], channels: usize, ring: &Arc<Mutex<VecDeque<i16>>>) {
    let frames = data.len() / channels.max(1);
    let mut ring = ring.lock();
    for f in 0..frames {
        let sample = ring.pop_front().unwrap_or(0); // silence when empty
        for c in 0..channels {
            data[f * channels + c] = sample;
        }
    }
    // Handle any tail when output buffer length isn't a multiple of channels.
    for s in data.iter_mut().skip(frames * channels) {
        *s = 0;
    }
}

fn fill_f32(data: &mut [f32], channels: usize, ring: &Arc<Mutex<VecDeque<i16>>>) {
    let frames = data.len() / channels.max(1);
    let mut ring = ring.lock();
    let scale = 1.0 / f32::from(i16::MAX);
    for f in 0..frames {
        let sample_i16 = ring.pop_front().unwrap_or(0);
        let sample_f32 = (sample_i16 as f32) * scale;
        for c in 0..channels {
            data[f * channels + c] = sample_f32;
        }
    }
    for s in data.iter_mut().skip(frames * channels) {
        *s = 0.0;
    }
}

fn fill_u16(data: &mut [u16], channels: usize, ring: &Arc<Mutex<VecDeque<i16>>>) {
    // u16 PCM is unsigned: 0..65535 with silence at 32768. Map i16 → u16 by
    // adding 32768 (offset binary representation).
    let frames = data.len() / channels.max(1);
    let mut ring = ring.lock();
    for f in 0..frames {
        let s_i16 = ring.pop_front().unwrap_or(0);
        let s_u16 = ((s_i16 as i32) + 32_768) as u16;
        for c in 0..channels {
            data[f * channels + c] = s_u16;
        }
    }
    for s in data.iter_mut().skip(frames * channels) {
        *s = 32_768;
    }
}

fn fill_u8(data: &mut [u8], channels: usize, ring: &Arc<Mutex<VecDeque<i16>>>) {
    // u8 PCM is unsigned 0..255 with silence at 128. Map i16 → u8 by
    // right-shifting 8 bits and adding 128.
    let frames = data.len() / channels.max(1);
    let mut ring = ring.lock();
    for f in 0..frames {
        let s_i16 = ring.pop_front().unwrap_or(0);
        // (i16 + 32768) >> 8  →  0..255
        let s_u8 = (((s_i16 as i32) + 32_768) >> 8) as u8;
        for c in 0..channels {
            data[f * channels + c] = s_u8;
        }
    }
    for s in data.iter_mut().skip(frames * channels) {
        *s = 128;
    }
}

// ───────────────────────── config selection ─────────────────────────

fn pick_output_config(device: &Device, desired_rate: u32) -> Result<(StreamConfig, SampleFormat)> {
    // Score sample formats so we *prefer* lossless integer paths: i16 matches
    // our internal pipeline 1:1, f32 is a clean float widen, u16/u8 work but
    // are the fallback. Without this ordering Linux PulseAudio/ALSA "default"
    // devices on some boxes report u8 first and we used to error out.
    fn format_score(f: SampleFormat) -> u8 {
        match f {
            SampleFormat::I16 => 4,
            SampleFormat::F32 => 3,
            SampleFormat::U16 => 2,
            SampleFormat::U8 => 1,
            _ => 0,
        }
    }

    if let Ok(supported) = device.supported_output_configs() {
        let supported: Vec<_> = supported.collect();
        // (channels-preference, format-score) — lower channels first, then best format.
        let candidate = supported
            .iter()
            .filter(|sc| {
                sc.min_sample_rate().0 <= desired_rate && sc.max_sample_rate().0 >= desired_rate
            })
            .max_by_key(|sc| {
                let mono_bonus = if sc.channels() == 1 { 10 } else { 0 };
                mono_bonus + format_score(sc.sample_format()) as i32
            });
        if let Some(sc) = candidate {
            let chosen = sc.with_sample_rate(cpal::SampleRate(desired_rate));
            return Ok((chosen.config(), chosen.sample_format()));
        }
    }
    // Fall back to device default — the cpal callback will simply consume the
    // ring at the device's rate. If rates mismatch, audio will pitch-shift;
    // we'd need resampling. Document + accept for V1; revisit if seen in dev.
    let default = device
        .default_output_config()
        .context("default_output_config")?;
    Ok((default.config(), default.sample_format()))
}

/// Parse strings like `pcm_16000` or `pcm_44100` from the
/// `conversation_initiation_metadata` event into a sample rate.
pub fn parse_pcm_format(spec: &str) -> Result<u32> {
    spec.strip_prefix("pcm_")
        .and_then(|n| n.parse::<u32>().ok())
        .ok_or_else(|| anyhow!("unrecognized audio format: {spec}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pcm_format() {
        assert_eq!(parse_pcm_format("pcm_16000").unwrap(), 16_000);
        assert_eq!(parse_pcm_format("pcm_44100").unwrap(), 44_100);
        assert!(parse_pcm_format("ulaw_8000").is_err());
        assert!(parse_pcm_format("pcm_abc").is_err());
    }

    #[test]
    fn handle_decode_and_push() {
        let handle = PlaybackHandle {
            ring: Arc::new(Mutex::new(VecDeque::new())),
            last_interrupt_id: Arc::new(AtomicU64::new(0)),
            output_sample_rate: 16_000,
            agent_sample_rate: 16_000,
            resampler: Arc::new(Mutex::new(ResampleState { pos: 0.0, prev: 0 })),
        };
        // PCM16-LE bytes for samples [1, -1, 1000]: 01 00, FF FF, E8 03
        let bytes = vec![0x01, 0x00, 0xFF, 0xFF, 0xE8, 0x03];
        handle.push_pcm16_le(&bytes);
        assert_eq!(handle.pending_samples(), 3);
        let mut ring = handle.ring.lock();
        assert_eq!(ring.pop_front(), Some(1));
        assert_eq!(ring.pop_front(), Some(-1));
        assert_eq!(ring.pop_front(), Some(1000));
    }

    #[test]
    fn interrupt_clears_ring_and_marks_id() {
        let handle = PlaybackHandle {
            ring: Arc::new(Mutex::new(VecDeque::from([1_i16, 2, 3]))),
            last_interrupt_id: Arc::new(AtomicU64::new(0)),
            output_sample_rate: 16_000,
            agent_sample_rate: 16_000,
            resampler: Arc::new(Mutex::new(ResampleState { pos: 0.0, prev: 0 })),
        };
        handle.interrupt(99);
        assert_eq!(handle.pending_samples(), 0);
        assert!(handle.is_audio_stale(99));
        assert!(handle.is_audio_stale(50));
        assert!(!handle.is_audio_stale(100));
    }

    #[test]
    fn base64_round_trip() {
        let handle = PlaybackHandle {
            ring: Arc::new(Mutex::new(VecDeque::new())),
            last_interrupt_id: Arc::new(AtomicU64::new(0)),
            output_sample_rate: 16_000,
            agent_sample_rate: 16_000,
            resampler: Arc::new(Mutex::new(ResampleState { pos: 0.0, prev: 0 })),
        };
        // PCM16-LE for [42]: 2A 00 → base64 "KgA="
        handle.push_base64("KgA=").unwrap();
        assert_eq!(handle.ring.lock().pop_front(), Some(42));
    }

    #[test]
    fn resamples_16k_to_48k() {
        // Agent sends 16 kHz, device runs at 48 kHz → expect ~3x output samples.
        let handle = PlaybackHandle {
            ring: Arc::new(Mutex::new(VecDeque::new())),
            last_interrupt_id: Arc::new(AtomicU64::new(0)),
            output_sample_rate: 48_000,
            agent_sample_rate: 16_000,
            resampler: Arc::new(Mutex::new(ResampleState { pos: 0.0, prev: 0 })),
        };
        // 100 input samples of a constant value → output should be ~300 samples,
        // all equal to that value (interpolating between equal points is flat).
        let mut bytes = Vec::new();
        for _ in 0..100 {
            bytes.extend_from_slice(&1000_i16.to_le_bytes());
        }
        handle.push_pcm16_le(&bytes);
        let produced = handle.pending_samples();
        assert!(
            (295..=305).contains(&produced),
            "expected ~300 samples, got {produced}"
        );
        // After the very first interpolated sample (which blends from prev=0),
        // the steady-state samples must equal the input level.
        let ring = handle.ring.lock();
        assert_eq!(ring[150], 1000);
    }

    #[test]
    fn resample_identity_when_rates_match() {
        let handle = PlaybackHandle {
            ring: Arc::new(Mutex::new(VecDeque::new())),
            last_interrupt_id: Arc::new(AtomicU64::new(0)),
            output_sample_rate: 16_000,
            agent_sample_rate: 16_000,
            resampler: Arc::new(Mutex::new(ResampleState { pos: 0.0, prev: 0 })),
        };
        let bytes = vec![0x01, 0x00, 0xFF, 0xFF, 0xE8, 0x03];
        handle.push_pcm16_le(&bytes);
        assert_eq!(handle.pending_samples(), 3);
        let mut ring = handle.ring.lock();
        assert_eq!(ring.pop_front(), Some(1));
        assert_eq!(ring.pop_front(), Some(-1));
        assert_eq!(ring.pop_front(), Some(1000));
    }
}
