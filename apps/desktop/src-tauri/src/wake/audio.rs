//! Microphone capture via cpal.
//!
//! Strategy:
//! 1. Take the default input device.
//! 2. Prefer 16kHz mono i16 directly when supported; otherwise use the
//!    device's default config and downsample / mix to mono in the callback.
//! 3. Push each frame onto a crossbeam channel for the wake worker.
//!
//! The cpal callback thread MUST NOT block — we `try_send` and drop frames
//! when the worker is behind. Dropped frames are extremely rare in practice
//! (Porcupine's 32ms frame budget is large compared to our ~20ms callbacks).

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use crossbeam_channel::Sender;

pub const TARGET_SAMPLE_RATE: u32 = 16_000;

/// Live mic capture. Holds the cpal `Stream` so it stays open until dropped.
pub struct AudioCapture {
    stream: Stream,
    device_name: String,
    actual_sample_rate: u32,
    actual_channels: u16,
}

impl AudioCapture {
    /// Open the default input device and start streaming i16 mono PCM into
    /// `tx`. Each `Vec<i16>` is one callback's worth of post-processed samples
    /// at TARGET_SAMPLE_RATE (16kHz), mono.
    pub fn start(tx: Sender<Vec<i16>>) -> Result<Self> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| anyhow!("no default audio input device"))?;
        let device_name = device.name().unwrap_or_else(|_| "unknown".into());

        let (config, sample_format) = pick_input_config(&device)?;
        let sample_rate = config.sample_rate.0;
        let channels = config.channels;
        log::info!(
            "audio: device={device_name} sample_rate={sample_rate} channels={channels} fmt={sample_format:?}"
        );

        let downsample = if sample_rate >= TARGET_SAMPLE_RATE {
            sample_rate / TARGET_SAMPLE_RATE
        } else {
            // Upsampling is out of scope; if a device gives us < 16kHz we
            // tell Porcupine and let it fail loudly.
            1
        };
        let channels_usize = channels as usize;

        let err_fn = |e| log::error!("audio stream error: {e}");

        let stream = match sample_format {
            SampleFormat::I16 => {
                let tx = tx.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        let out = process_i16(data, channels_usize, downsample);
                        let _ = tx.try_send(out);
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::F32 => {
                let tx = tx.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[f32], _| {
                        let out = process_f32(data, channels_usize, downsample);
                        let _ = tx.try_send(out);
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::U16 => {
                let tx = tx.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[u16], _| {
                        let out = process_u16(data, channels_usize, downsample);
                        let _ = tx.try_send(out);
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
            stream,
            device_name,
            actual_sample_rate: sample_rate,
            actual_channels: channels,
        })
    }

    pub fn device_name(&self) -> &str {
        &self.device_name
    }

    pub fn sample_rate(&self) -> u32 {
        self.actual_sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.actual_channels
    }

    /// Explicitly stop the stream. Called by Drop too; safe to call twice.
    pub fn stop(&self) {
        if let Err(err) = self.stream.pause() {
            log::warn!("audio: stop error: {err}");
        }
    }
}

impl Drop for AudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

// ───────────────────────── config selection ─────────────────────────

fn pick_input_config(device: &Device) -> Result<(StreamConfig, SampleFormat)> {
    // First preference: native 16kHz mono.
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

    // Otherwise accept the device default and we'll mix/decimate.
    let default = device
        .default_input_config()
        .context("default_input_config")?;
    let sample_format = default.sample_format();
    let config = default.config();
    Ok((config, sample_format))
}

// ───────────────────────── per-format processing ─────────────────────────

fn process_i16(data: &[i16], channels: usize, downsample: u32) -> Vec<i16> {
    let mono = mix_to_mono_i16(data, channels);
    decimate(&mono, downsample)
}

fn process_f32(data: &[f32], channels: usize, downsample: u32) -> Vec<i16> {
    let mono: Vec<i16> = if channels <= 1 {
        data.iter().map(f32_to_i16).collect()
    } else {
        data.chunks(channels)
            .map(|c| {
                let avg = c.iter().copied().sum::<f32>() / c.len() as f32;
                f32_to_i16(&avg)
            })
            .collect()
    };
    decimate(&mono, downsample)
}

fn process_u16(data: &[u16], channels: usize, downsample: u32) -> Vec<i16> {
    let i16_buf: Vec<i16> = data.iter().map(|&u| u16_to_i16(u)).collect();
    let mono = mix_to_mono_i16(&i16_buf, channels);
    decimate(&mono, downsample)
}

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

/// Box-filter + decimate. Crude but adequate for wake-word; revisit with a
/// proper anti-alias if FPR rises after Phase 0.D Day-3 ambient tests.
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

    #[test]
    fn mono_passes_through_unchanged() {
        let data: Vec<i16> = (0..16).collect();
        let out = mix_to_mono_i16(&data, 1);
        assert_eq!(out, data);
    }

    #[test]
    fn stereo_averages_to_mono() {
        // L,R interleaved: 100,200 → 150
        let data: Vec<i16> = vec![100, 200, -100, -200, 0, 0];
        let out = mix_to_mono_i16(&data, 2);
        assert_eq!(out, vec![150, -150, 0]);
    }

    #[test]
    fn decimate_factor_1_is_identity() {
        let data: Vec<i16> = vec![1, 2, 3, 4];
        assert_eq!(decimate(&data, 1), data);
    }

    #[test]
    fn decimate_factor_3_box_filter() {
        // 9 samples → 3 windows of 3 → averaged
        let data: Vec<i16> = vec![3, 3, 3, 6, 6, 6, 9, 9, 9];
        assert_eq!(decimate(&data, 3), vec![3, 6, 9]);
    }

    #[test]
    fn f32_clamps_and_scales() {
        assert_eq!(f32_to_i16(&1.0), i16::MAX);
        assert_eq!(f32_to_i16(&-1.0), -i16::MAX); // clamped at -i16::MAX, not MIN
        assert_eq!(f32_to_i16(&2.0), i16::MAX);
        assert_eq!(f32_to_i16(&0.0), 0);
    }

    #[test]
    fn u16_to_i16_centers_zero() {
        assert_eq!(u16_to_i16(32768), 0);
        assert_eq!(u16_to_i16(0), i16::MIN);
        assert_eq!(u16_to_i16(65535), i16::MAX);
    }
}
