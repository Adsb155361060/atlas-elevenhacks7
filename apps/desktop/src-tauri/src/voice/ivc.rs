//! Instant Voice Clone — recording + uploading.
//!
//! Two upload paths:
//! * Record 30s in-process from the default mic, encode WAV in-memory, POST
//!   to the worker.
//! * Upload an arbitrary WAV/MP3/M4A blob the user already has.
//!
//! Both end up at `POST {ATLAS_WORKER_URL}/v1/voices/clone`, which is the
//! Bearer-token-protected proxy in front of ElevenLabs `/v1/voices/add`.
//! Returns `{ voice_id, requires_verification }` on success.

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use hound::{SampleFormat as HoundSampleFormat, WavSpec, WavWriter};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::env;
use std::io::Cursor;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// IVC WAV target. 16kHz mono PCM16 is the simplest valid input for
/// ElevenLabs IVC and matches the rest of our audio pipeline.
const IVC_SAMPLE_RATE: u32 = 16_000;

/// Result of a successful IVC clone — what the worker (and ElevenLabs)
/// returns. Surfaced to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloneResult {
    pub voice_id: String,
    #[serde(default)]
    pub requires_verification: bool,
}

/// Record `duration` of mic audio into a single in-memory WAV blob. cpal's
/// `Stream` is `!Send` on Linux — this function blocks the calling thread
/// (call it from `tauri::async_runtime::spawn_blocking`).
pub fn record_wav_blocking(duration: Duration) -> Result<Vec<u8>> {
    if duration.as_secs() < 5 {
        return Err(anyhow!("recording must be at least 5 seconds"));
    }
    if duration.as_secs() > 300 {
        return Err(anyhow!("recording cannot exceed 5 minutes"));
    }

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| anyhow!("no default audio input device"))?;
    let default_config = device
        .default_input_config()
        .context("default_input_config")?;
    let sample_format = default_config.sample_format();
    let config: StreamConfig = default_config.config();
    let device_rate = config.sample_rate.0;
    let channels = config.channels as usize;

    let downsample = if device_rate >= IVC_SAMPLE_RATE {
        device_rate / IVC_SAMPLE_RATE
    } else {
        1
    };

    let buffer: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::with_capacity(
        (IVC_SAMPLE_RATE as usize) * duration.as_secs() as usize,
    )));

    let err_fn = |e| log::error!("ivc/record: stream error: {e}");
    let stream = match sample_format {
        SampleFormat::I16 => {
            let buf = buffer.clone();
            device.build_input_stream(
                &config,
                move |data: &[i16], _| {
                    let mono = mix_to_mono_i16(data, channels);
                    let down = decimate(&mono, downsample);
                    buf.lock().extend_from_slice(&down);
                },
                err_fn,
                None,
            )
        }
        SampleFormat::F32 => {
            let buf = buffer.clone();
            device.build_input_stream(
                &config,
                move |data: &[f32], _| {
                    let mono = mix_to_mono_f32_as_i16(data, channels);
                    let down = decimate(&mono, downsample);
                    buf.lock().extend_from_slice(&down);
                },
                err_fn,
                None,
            )
        }
        other => return Err(anyhow!("unsupported sample format: {other:?}")),
    }
    .context("build_input_stream")?;

    stream.play().context("stream.play")?;

    let start = Instant::now();
    while start.elapsed() < duration {
        std::thread::sleep(Duration::from_millis(50));
    }
    drop(stream); // explicit; closes device

    let samples = buffer.lock().clone();
    log::info!(
        "ivc/record: captured {} samples ({} ms @ 16kHz)",
        samples.len(),
        (samples.len() * 1000) / IVC_SAMPLE_RATE as usize
    );
    encode_wav(&samples)
}

/// Wrap raw 16kHz mono PCM16 samples into an in-memory WAV file.
pub fn encode_wav(samples: &[i16]) -> Result<Vec<u8>> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: IVC_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: HoundSampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::<u8>::with_capacity(samples.len() * 2 + 44));
    {
        let mut writer = WavWriter::new(&mut cursor, spec).context("wav writer init")?;
        for &sample in samples {
            writer.write_sample(sample).context("wav write sample")?;
        }
        writer.finalize().context("wav finalize")?;
    }
    Ok(cursor.into_inner())
}

/// Upload either a freshly-recorded WAV (from `record_wav_blocking`) or an
/// arbitrary user-supplied audio blob to the worker.
pub async fn upload_clone(
    audio_bytes: Vec<u8>,
    filename: &str,
    voice_name: &str,
    description: Option<&str>,
) -> Result<CloneResult> {
    let (worker_url, token) = worker_credentials()?;
    let endpoint = format!("{}/v1/voices/clone", worker_url.trim_end_matches('/'));

    let mime = mime_from_filename(filename);
    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(filename.to_string())
        .mime_str(mime)
        .map_err(|e| anyhow!("invalid mime: {e}"))?;

    let mut form = reqwest::multipart::Form::new()
        .text("name", voice_name.to_string())
        .part("files", part);
    if let Some(d) = description {
        form = form.text("description", d.to_string());
    }

    log::info!(
        "ivc/upload: POST {endpoint} (name='{voice_name}', filename='{filename}', mime='{mime}')"
    );
    let resp = reqwest::Client::new()
        .post(&endpoint)
        .bearer_auth(&token)
        .multipart(form)
        .send()
        .await
        .context("voices/clone request")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("voices/clone {status}: {body}"));
    }
    let parsed: CloneResult = resp.json().await.context("voices/clone parse response")?;
    log::info!("ivc/upload: cloned voice_id={}", parsed.voice_id);
    Ok(parsed)
}

/// Proxy ElevenLabs voice list through the worker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceList {
    /// Pass-through raw response. The frontend renders from this; we don't
    /// model individual fields here because the upstream schema evolves.
    pub raw: serde_json::Value,
}

pub async fn list_voices(query: Option<&str>) -> Result<VoiceList> {
    let (worker_url, token) = worker_credentials()?;
    let mut url = format!("{}/v1/voices", worker_url.trim_end_matches('/'));
    if let Some(q) = query {
        if !q.is_empty() {
            url.push_str("?search=");
            url.push_str(&urlencode(q));
        }
    }
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .context("voices list request")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("voices list {status}: {body}"));
    }
    let raw: serde_json::Value = resp.json().await.context("voices list parse")?;
    Ok(VoiceList { raw })
}

// ───────────────────────── helpers ─────────────────────────

fn worker_credentials() -> Result<(String, String)> {
    let url = env::var("ATLAS_WORKER_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("ATLAS_WORKER_URL not set"))?;
    let token = env::var("ATLAS_AGENT_TOKEN")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("ATLAS_AGENT_TOKEN not set"))?;
    Ok((url, token))
}

fn mime_from_filename(filename: &str) -> &'static str {
    let lower = filename.to_ascii_lowercase();
    if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".m4a") || lower.ends_with(".mp4") {
        "audio/mp4"
    } else if lower.ends_with(".ogg") || lower.ends_with(".oga") {
        "audio/ogg"
    } else if lower.ends_with(".flac") {
        "audio/flac"
    } else if lower.ends_with(".webm") {
        "audio/webm"
    } else {
        "application/octet-stream"
    }
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_round_trip() {
        let samples: Vec<i16> = (0..160).map(|i| (i * 100) as i16).collect();
        let wav = encode_wav(&samples).unwrap();
        // WAV header is 44 bytes; payload is 2 bytes/sample.
        assert!(wav.len() >= 44 + samples.len() * 2);
        // RIFF magic at offset 0
        assert_eq!(&wav[0..4], b"RIFF");
        // WAVE magic at offset 8
        assert_eq!(&wav[8..12], b"WAVE");
    }

    #[test]
    fn mime_detection() {
        assert_eq!(mime_from_filename("sample.wav"), "audio/wav");
        assert_eq!(mime_from_filename("SAMPLE.WAV"), "audio/wav");
        assert_eq!(mime_from_filename("song.mp3"), "audio/mpeg");
        assert_eq!(mime_from_filename("clip.m4a"), "audio/mp4");
        assert_eq!(
            mime_from_filename("unknown.xyz"),
            "application/octet-stream"
        );
    }

    #[test]
    fn urlencode_handles_unsafe() {
        assert_eq!(urlencode("hi-there.1"), "hi-there.1");
        assert_eq!(urlencode("hi there!"), "hi%20there%21");
    }
}
