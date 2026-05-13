//! Voice-loop orchestrator.
//!
//! Glues the four sub-modules together:
//! * `protocol` — wire types for ElevenLabs Conv-AI events
//! * `capture`  — mic → 16kHz mono PCM16 → 250ms base64 chunks → outbound queue
//! * `playback` — agent audio (base64 PCM16) → cpal output stream → speaker
//! * `client`   — WebSocket lifecycle: connect, init, dispatch, send
//!
//! The orchestrator:
//! 1. On boot (if `ATLAS_AGENT_ID` is set), starts a `Playback` and a
//!    `AgentCapture`, both leaked (cpal::Stream is `!Send` on Linux).
//! 2. Listens for `wake:fired` events from `wake/`.
//! 3. On each wake, spawns a `client::run` task with a `SessionCallbacks`
//!    impl that drives the global `AtlasState` machine and re-emits
//!    transcripts to the frontend (`atlas:transcript:user` etc.).
//! 4. Gracefully disables itself when configuration is missing — logs once,
//!    app boots normally.

mod capture;
mod client;
pub mod ivc;
pub mod memory;
mod playback;
pub mod preferences;
mod protocol;

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener, Manager, Runtime};
use tokio::sync::mpsc;

use crate::state::{self, AtlasState, StateChannel};

pub use client::{ClientCommand, SessionCallbacks, SessionConfig};

/// Live voice-loop runtime. Held in Tauri's managed state for the app
/// lifetime. The actual `Playback` / `AgentCapture` are intentionally leaked
/// (see module docs) so this struct is `Send + Sync` cleanly.
pub struct VoiceHandle {
    /// Sender into the active session's command channel, swapped per turn.
    /// `None` between sessions.
    pub active_session_tx: parking_lot::Mutex<Option<mpsc::UnboundedSender<ClientCommand>>>,
    config_template: SessionConfig,
}

impl VoiceHandle {
    /// Send a command to the *current* session if one is live. Returns `true`
    /// if the command was queued.
    pub fn send_command(&self, cmd: ClientCommand) -> bool {
        if let Some(tx) = &*self.active_session_tx.lock() {
            return tx.send(cmd).is_ok();
        }
        false
    }
}

/// Start the voice loop if `ATLAS_AGENT_ID` is configured. Returns `None`
/// with a logged warning otherwise.
pub fn start_if_configured<R: Runtime>(app: &AppHandle<R>) -> Result<Option<VoiceHandle>> {
    let agent_id = match env::var("ATLAS_AGENT_ID") {
        Ok(s) if !s.is_empty() => s,
        _ => {
            log::warn!(
                "voice loop disabled: ATLAS_AGENT_ID not set (fire_wake_test still simulates, but no agent will respond)"
            );
            return Ok(None);
        }
    };
    let api_key = env::var("ELEVENLABS_API_KEY").ok().filter(|s| !s.is_empty());
    let environment = env::var("ATLAS_ENV").ok().filter(|s| !s.is_empty());

    // Boot playback at 16kHz to match what our agent_config_v1 sets for
    // `agent_output_audio_format` (pcm_16000). If the agent's actual config
    // differs, `client` logs a warning and we may pitch-shift; resampling is
    // a follow-up.
    let playback_owner = playback::Playback::start(16_000).context("playback start")?;
    let playback_handle = playback_owner.handle();
    log::info!(
        "voice/playback: device='{}' rate={}Hz",
        playback_owner.device_name(),
        playback_handle.output_sample_rate(),
    );

    // We'll capture mic per-session (capture needs the session's command
    // sender), not at boot. So no leaked capture struct here.

    // Intentional leak — cpal::Stream is `!Send` on Linux ALSA. The OS
    // reclaims the device at process exit.
    std::mem::forget(playback_owner);

    let config_template = SessionConfig {
        agent_id,
        api_key,
        environment,
        dynamic_variables: default_dynamic_variables(),
        conversation_config_override: None,
        custom_llm_extra_body: None,
        user_id: None,
    };

    let handle = VoiceHandle {
        active_session_tx: parking_lot::Mutex::new(None),
        config_template,
    };

    // Subscribe to wake:fired events. Each fire kicks off a session.
    spawn_wake_listener(app, playback_handle);

    Ok(Some(handle))
}

fn default_dynamic_variables() -> HashMap<String, Value> {
    let mut vars = HashMap::new();
    // Optional user-name pulled from $USER for {{user_name}} in system prompt.
    // Falls back to empty (the ElevenLabs dashboard placeholder default "there"
    // covers it).
    if let Ok(user) = env::var("USER") {
        if !user.is_empty() {
            vars.insert("user_name".to_string(), Value::String(user));
        }
    }
    vars
}

/// Listen for `wake:fired` events and start one session per fire. Concurrent
/// fires while a session is live are ignored (the existing session stays).
fn spawn_wake_listener<R: Runtime>(app: &AppHandle<R>, playback: playback::PlaybackHandle) {
    let app_clone = app.clone();
    app.listen("wake:fired", move |_event| {
        let app = app_clone.clone();
        let playback = playback.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = start_session(app, playback).await {
                log::warn!("voice: session ended with error: {err:#}");
            }
        });
    });
}

async fn start_session<R: Runtime>(
    app: AppHandle<R>,
    playback: playback::PlaybackHandle,
) -> Result<()> {
    // Set up channels + claim the active-session slot. All work that touches
    // the `tauri::State` borrow happens in this block; the borrow ends at the
    // block's close, before we await anything.
    let (tx, rx, callbacks, mut config) = {
        let voice = app
            .try_state::<VoiceHandle>()
            .ok_or_else(|| anyhow!("voice handle not managed"))?;

        // One session at a time. If a session is already active, drop this wake.
        if voice.active_session_tx.lock().is_some() {
            log::debug!("voice: wake fired but session already active — ignored");
            return Ok(());
        }

        let (tx, rx) = mpsc::unbounded_channel::<ClientCommand>();
        *voice.active_session_tx.lock() = Some(tx.clone());

        let callbacks: Arc<dyn SessionCallbacks> =
            Arc::new(OrchestratorCallbacks::new(app.clone()));
        let config = voice.config_template.clone();
        (tx, rx, callbacks, config)
    };

    // Inject the user's chosen voice_id (Phase 0.F). If none is configured,
    // the agent's dashboard default (ADR 0016 — Adam) is used.
    if let Ok(prefs) = preferences::read(&app) {
        if let Some(voice_id) = prefs.voice_id.as_deref() {
            config.conversation_config_override = Some(merge_voice_override(
                config.conversation_config_override.take(),
                voice_id,
            ));
            log::debug!("voice: session voice_id override = {voice_id}");
        }
    }

    // Inject recent_context from prior turns (Batch 4 memory). The agent
    // sees this as a dynamic_variable in the system prompt — useful for
    // "remember when I asked about X" follow-ups without any embedding
    // infrastructure.
    if let Some(ctx) = memory::recent_context(&app) {
        config
            .dynamic_variables
            .insert("recent_context".to_string(), Value::String(ctx));
        log::debug!("voice: injected recent_context into dynamic_variables");
    }

    // Spawn the mic capture on a dedicated OS thread. cpal::Stream is !Send
    // on Linux ALSA, so we cannot hold the AgentCapture across an await on
    // tokio's multi-threaded runtime. The thread owns the stream for the
    // session and drops it (closing the device) when we signal shutdown.
    let (init_tx, init_rx) = tokio::sync::oneshot::channel::<Result<MicMeta>>();
    let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel::<()>();
    let capture_tx = tx.clone();
    std::thread::Builder::new()
        .name("voice-mic".into())
        .spawn(move || match capture::AgentCapture::start(capture_tx) {
            Ok(cap) => {
                let meta = MicMeta {
                    device: cap.device_name().to_string(),
                    sample_rate: cap.sample_rate(),
                };
                let _ = init_tx.send(Ok(meta));
                // Block until the orchestrator signals end-of-session (or the
                // sender drops, indicating panic).
                let _ = shutdown_rx.recv();
                drop(cap); // closes the audio device cleanly
            }
            Err(err) => {
                let _ = init_tx.send(Err(err));
            }
        })
        .context("spawn voice-mic thread")?;

    match init_rx.await {
        Ok(Ok(meta)) => {
            log::info!(
                "voice/capture: device='{}' rate={}Hz",
                meta.device,
                meta.sample_rate
            );
        }
        Ok(Err(err)) => {
            clear_voice_tx(&app);
            return Err(err.context("agent capture start"));
        }
        Err(_) => {
            clear_voice_tx(&app);
            return Err(anyhow!("voice-mic init channel closed"));
        }
    }

    let result = client::run(config, callbacks, playback, rx, tx).await;

    // Tell the mic thread to release the audio device.
    let _ = shutdown_tx.send(());

    // Session ended — clear the active tx so the next wake can start a new one.
    clear_voice_tx(&app);
    if let Err(err) = state::set(&app, AtlasState::Idle) {
        log::warn!("voice: failed to return to Idle: {err:#}");
    }
    result
}

/// Helper: clear the active session sender.
fn clear_voice_tx<R: Runtime>(app: &AppHandle<R>) {
    if let Some(voice) = app.try_state::<VoiceHandle>() {
        *voice.active_session_tx.lock() = None;
    }
}

/// Merge a `tts.voice_id` override into the existing
/// `conversation_config_override` value. Preserves any other overrides the
/// caller already set.
fn merge_voice_override(existing: Option<Value>, voice_id: &str) -> Value {
    use serde_json::Map;
    let mut root = match existing {
        Some(Value::Object(m)) => m,
        _ => Map::new(),
    };
    let mut tts = match root.remove("tts") {
        Some(Value::Object(m)) => m,
        _ => Map::new(),
    };
    tts.insert("voice_id".to_string(), Value::String(voice_id.to_string()));
    root.insert("tts".to_string(), Value::Object(tts));
    Value::Object(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn voice_override_into_empty_config() {
        let merged = merge_voice_override(None, "v_abc");
        assert_eq!(merged, json!({"tts": {"voice_id": "v_abc"}}));
    }

    #[test]
    fn voice_override_preserves_other_keys() {
        let existing = json!({
            "tts": {"speed": 1.2},
            "language": "en"
        });
        let merged = merge_voice_override(Some(existing), "v_abc");
        assert_eq!(
            merged,
            json!({
                "tts": {"speed": 1.2, "voice_id": "v_abc"},
                "language": "en"
            })
        );
    }
}

/// Reported back from the dedicated mic thread once the cpal stream is open.
struct MicMeta {
    device: String,
    sample_rate: u32,
}

// ───────────────────────── callbacks ─────────────────────────

struct OrchestratorCallbacks<R: Runtime> {
    app: AppHandle<R>,
    first_audio: AtomicBool,
    live_session: memory::LiveSession,
}

impl<R: Runtime> OrchestratorCallbacks<R> {
    fn new(app: AppHandle<R>) -> Self {
        Self {
            app,
            first_audio: AtomicBool::new(false),
            live_session: memory::LiveSession::default(),
        }
    }
}

impl<R: Runtime> SessionCallbacks for OrchestratorCallbacks<R> {
    fn on_init(&self, conversation_id: &str, output_audio_format: &str) {
        log::info!(
            "voice: session started {conversation_id} (agent_out={output_audio_format})"
        );
        let _ = state::set(&self.app, AtlasState::Listening);
        let _ = self
            .app
            .emit("voice:session_started", conversation_id.to_string());
    }

    fn on_user_transcript(&self, transcript: &str) {
        // User finished an utterance — Claude is now composing.
        let _ = state::set(&self.app, AtlasState::Thinking);
        self.live_session.ingest_user(transcript);
        let _ = self
            .app
            .emit("atlas:transcript:user", transcript.to_string());
    }

    fn on_agent_response(&self, response: &str) {
        self.live_session.ingest_agent(response);
        // A completed user+agent pair gets appended to memory.
        if let Some(turn) = self.live_session.take_completed() {
            if let Err(err) = memory::append_turn(&self.app, turn) {
                log::warn!("voice/memory: append failed: {err:#}");
            }
        }
        let _ = self
            .app
            .emit("atlas:transcript:agent", response.to_string());
    }

    fn on_agent_response_correction(&self, _original: &str, corrected: &str) {
        // Truncated reply (e.g., after interruption). Frontend should replace
        // the last agent line with this corrected one.
        let _ = self
            .app
            .emit("atlas:transcript:agent_corrected", corrected.to_string());
    }

    fn on_first_audio(&self) {
        if !self.first_audio.swap(true, Ordering::AcqRel) {
            let _ = state::set(&self.app, AtlasState::Speaking);
        }
    }

    fn on_interruption(&self, _event_id: u64) {
        // User interrupted; back to listening.
        let _ = state::set(&self.app, AtlasState::Listening);
        self.first_audio.store(false, Ordering::Release);
        let _ = self.app.emit("voice:interruption", ());
    }

    fn on_vad_score(&self, score: f32) {
        // Optional — surfaced for diagnostics. The frontend can render a
        // mic-level meter from these.
        let _ = self.app.emit("voice:vad", score);
    }

    fn on_client_tool_call(
        &self,
        tool_name: &str,
        tool_call_id: &str,
        parameters: &HashMap<String, Value>,
    ) {
        // Convert the HashMap into a single Value so the tools dispatcher can
        // accept arbitrarily-shaped param payloads (objects, arrays, primitives).
        let params_value = Value::Object(parameters.clone().into_iter().collect());
        log::info!("voice: client_tool_call name={tool_name} id={tool_call_id}");

        // Surface to the frontend regardless of dispatch outcome — useful for
        // a debug HUD or future telemetry. Drops `parameters` deliberately
        // (potentially large or sensitive) — frontend can re-derive from
        // `atlas:artifact` if it needs the actual payload.
        let _ = self.app.emit(
            "voice:client_tool_call",
            serde_json::json!({
                "tool_name": tool_name,
                "tool_call_id": tool_call_id,
            }),
        );

        let outcome = crate::tools::dispatch(&self.app, tool_name, &params_value);

        // Surface dispatch outcome so the frontend can hide the in-flight
        // badge and (on error) raise a toast.
        let result_preview = if outcome.is_error {
            outcome
                .result
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "tool failed".to_string())
        } else {
            String::new()
        };
        let _ = self.app.emit(
            "voice:client_tool_result",
            serde_json::json!({
                "tool_name": tool_name,
                "tool_call_id": tool_call_id,
                "is_error": outcome.is_error,
                "error_message": result_preview,
            }),
        );

        if let Some(voice) = self.app.try_state::<VoiceHandle>() {
            // Encode the result Value as a JSON string for the agent —
            // ElevenLabs Conv-AI expects `result: string`. Pretty-printing it
            // is fine; the LLM tolerates whitespace.
            let result_str = match serde_json::to_string(&outcome.result) {
                Ok(s) => s,
                Err(err) => {
                    log::warn!("tools: serialize result failed: {err}");
                    format!("{{\"error\": \"serialize failed: {err}\"}}")
                }
            };
            voice.send_command(ClientCommand::SendToolResult {
                tool_call_id: tool_call_id.to_string(),
                result: result_str,
                is_error: outcome.is_error,
            });
        }
    }

    fn on_session_end(&self) {
        log::info!("voice: session ended");
        let _ = self.app.emit("voice:session_ended", ());
    }
}

// ───────────────────────── pause integration ─────────────────────────

/// Reflect `AtlasState::Paused` into a graceful session close. Mirrors the
/// pause-watcher pattern used by the wake module. Called from `lib.rs::setup`.
pub fn spawn_pause_watcher<R: Runtime>(app: &AppHandle<R>) {
    let state_handle = app.state::<StateChannel>();
    let mut rx = state_handle.rx.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut was_paused = false;
        loop {
            let current = *rx.borrow();
            let is_paused = matches!(current, AtlasState::Paused);
            if is_paused && !was_paused {
                if let Some(voice) = app.try_state::<VoiceHandle>() {
                    voice.send_command(ClientCommand::Close);
                }
            }
            was_paused = is_paused;
            if rx.changed().await.is_err() {
                break;
            }
        }
        log::debug!("voice pause watcher exited");
    });
}

// ───────────────────────── debug command ─────────────────────────

/// Manually queue a `user_message` text frame into the active session.
/// Useful for testing the agent loop without speaking. Behind
/// `cfg(debug_assertions)` in commands.rs.
pub fn send_test_user_message<R: Runtime>(app: &AppHandle<R>, text: &str) {
    if let Some(voice) = app.try_state::<VoiceHandle>() {
        let queued = voice.send_command(ClientCommand::SendUserMessage(text.to_string()));
        if !queued {
            log::warn!("voice: no active session for test user message");
        }
    }
}
