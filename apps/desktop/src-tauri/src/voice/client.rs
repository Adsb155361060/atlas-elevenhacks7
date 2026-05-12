//! ElevenLabs Conversational Agent WebSocket client.
//!
//! Lifecycle:
//! 1. Resolve URL — public agent: build `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=…`.
//!    Private agent (`requires_auth=true`): `GET /v1/convai/conversation/get-signed-url?agent_id=…`
//!    with `xi-api-key` header, then WS to the returned signed URL.
//! 2. Open WS, send `conversation_initiation_client_data` once.
//! 3. Loop:
//!    - read frames → parse `ServerEvent` → dispatch (audio, transcript, ping, …)
//!    - drain a `tokio::mpsc<ClientCommand>` for outbound messages (audio
//!      chunks, pongs, tool results)
//! 4. On close / error, emit a `voice:closed` event so the orchestrator can
//!    transition state and (optionally) reconnect.

use anyhow::{anyhow, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio_tungstenite::tungstenite::Message;

use super::playback::{self, PlaybackHandle};
use super::protocol::{self, ClientEvent, ServerEvent, SourceInfo};

const SOURCE_NAME: &str = "atlas_desktop";
const SOURCE_VERSION: &str = env!("CARGO_PKG_VERSION");
const ELEVENLABS_BASE: &str = "https://api.elevenlabs.io";

/// Outbound commands the orchestrator (and capture thread) can send to the
/// client task. All outbound writes flow through the same channel so they
/// serialize cleanly against a single WebSocket sink.
///
/// A few variants (UserMessage, ContextualUpdate, UserActivity) aren't fired
/// automatically in Phase 0.E — they're exposed for the debug Tauri command
/// `send_user_message_test` and Phase 1+ workflows.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum ClientCommand {
    /// Pre-base64-encoded PCM16-LE audio chunk for `user_audio_chunk`.
    SendUserAudio(String),
    /// `pong` in response to a server `ping`.
    SendPong { event_id: u64 },
    /// `client_tool_result` in response to a server-side `client_tool_call`.
    SendToolResult {
        tool_call_id: String,
        result: String,
        is_error: bool,
    },
    /// `user_message` text frame.
    SendUserMessage(String),
    /// `contextual_update` text frame.
    SendContextualUpdate(String),
    /// `user_activity` ping to reset turn timeout.
    SendUserActivity,
    /// Graceful close.
    Close,
}

/// Per-session configuration carried into `start`.
#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub agent_id: String,
    /// If `Some`, fetch a signed URL with this key before connecting.
    /// Public (no-auth) agents pass `None`.
    pub api_key: Option<String>,
    /// Optional environment override (e.g. `staging`).
    pub environment: Option<String>,
    /// Optional dynamic variables to pass in the init message
    /// (`{{user_name}}`, etc.).
    pub dynamic_variables: HashMap<String, Value>,
    /// Optional per-session config override (voice id, language, ...).
    pub conversation_config_override: Option<Value>,
    /// Optional custom LLM extra body forwarded to the Worker.
    pub custom_llm_extra_body: Option<Value>,
    /// Optional end-user id (for analytics / consent records).
    pub user_id: Option<String>,
}

/// Callbacks fired by the client as events arrive. Orchestrator implements
/// these and wires them to Tauri events / state transitions.
pub trait SessionCallbacks: Send + Sync + 'static {
    fn on_init(&self, conversation_id: &str, output_audio_format: &str);
    fn on_user_transcript(&self, transcript: &str);
    fn on_agent_response(&self, response: &str);
    fn on_agent_response_correction(&self, original: &str, corrected: &str);
    fn on_first_audio(&self);
    fn on_interruption(&self, event_id: u64);
    fn on_vad_score(&self, score: f32);
    fn on_client_tool_call(
        &self,
        tool_name: &str,
        tool_call_id: &str,
        parameters: &HashMap<String, Value>,
    );
    fn on_session_end(&self);
}

/// Establish the WebSocket session and run until close. Returns when the
/// connection drops or the orchestrator sends `ClientCommand::Close`.
pub async fn run(
    config: SessionConfig,
    callbacks: Arc<dyn SessionCallbacks>,
    playback: PlaybackHandle,
    mut commands_rx: UnboundedReceiver<ClientCommand>,
    commands_tx: UnboundedSender<ClientCommand>,
) -> Result<()> {
    let url = resolve_ws_url(&config).await.context("resolve ws url")?;
    log::info!("voice/client: connecting to {url}");

    let (ws, _resp) = tokio_tungstenite::connect_async(url.as_str())
        .await
        .context("WebSocket connect")?;
    log::info!("voice/client: connected");

    let (mut sink, mut stream) = ws.split();

    // 1) Send the initiation message immediately.
    let init = build_initiation(&config);
    sink.send(Message::Text(init))
        .await
        .context("send initiation")?;

    // 2) Set up a flag so we can fire `on_first_audio` exactly once.
    let mut first_audio_fired = false;

    loop {
        tokio::select! {
            // ── outbound commands ──
            cmd = commands_rx.recv() => {
                match cmd {
                    Some(ClientCommand::SendUserAudio(b64)) => {
                        let frame = format!(r#"{{"user_audio_chunk":"{b64}"}}"#);
                        if let Err(err) = sink.send(Message::Text(frame)).await {
                            log::warn!("voice/client: send audio failed: {err}");
                            break;
                        }
                    }
                    Some(ClientCommand::SendPong { event_id }) => {
                        let evt = ClientEvent::Pong { event_id };
                        send_json(&mut sink, &evt).await?;
                    }
                    Some(ClientCommand::SendToolResult { tool_call_id, result, is_error }) => {
                        let evt = ClientEvent::ClientToolResult { tool_call_id, result, is_error };
                        send_json(&mut sink, &evt).await?;
                    }
                    Some(ClientCommand::SendUserMessage(text)) => {
                        let evt = ClientEvent::UserMessage { text: &text };
                        send_json(&mut sink, &evt).await?;
                    }
                    Some(ClientCommand::SendContextualUpdate(text)) => {
                        let evt = ClientEvent::ContextualUpdate { text: &text };
                        send_json(&mut sink, &evt).await?;
                    }
                    Some(ClientCommand::SendUserActivity) => {
                        let evt = ClientEvent::UserActivity {};
                        send_json(&mut sink, &evt).await?;
                    }
                    Some(ClientCommand::Close) | None => {
                        log::info!("voice/client: close requested");
                        let _ = sink.send(Message::Close(None)).await;
                        break;
                    }
                }
            }

            // ── inbound frames ──
            frame = stream.next() => {
                match frame {
                    Some(Ok(Message::Text(text))) => {
                        match protocol::parse_server_event(&text) {
                            Ok(evt) => dispatch_event(
                                evt,
                                &callbacks,
                                &playback,
                                &commands_tx,
                                &mut first_audio_fired,
                            ),
                            Err(err) => log::warn!("voice/client: parse error: {err} (frame: {text})"),
                        }
                    }
                    Some(Ok(Message::Binary(_))) => {
                        // Conv-AI uses text frames for events; binary frames are
                        // unused. Ignore.
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        // tungstenite handles WS-level pong automatically when
                        // configured, but emit one defensively.
                        let _ = sink.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(frame))) => {
                        log::info!("voice/client: server closed: {frame:?}");
                        break;
                    }
                    Some(Ok(Message::Frame(_))) => { /* low-level, ignore */ }
                    Some(Err(err)) => {
                        log::warn!("voice/client: ws error: {err}");
                        break;
                    }
                    None => {
                        log::info!("voice/client: stream ended");
                        break;
                    }
                }
            }
        }
    }

    callbacks.on_session_end();
    Ok(())
}

fn dispatch_event(
    evt: ServerEvent,
    callbacks: &Arc<dyn SessionCallbacks>,
    playback: &PlaybackHandle,
    commands_tx: &UnboundedSender<ClientCommand>,
    first_audio_fired: &mut bool,
) {
    match evt {
        ServerEvent::ConversationInitiationMetadata {
            conversation_initiation_metadata_event: meta,
        } => {
            log::info!(
                "voice/client: session={} agent_out={} user_in={}",
                meta.conversation_id,
                meta.agent_output_audio_format,
                meta.user_input_audio_format
            );
            // Warn-but-don't-fail if the agent's output format doesn't match
            // what `playback` is configured for. Resampling lives in a
            // follow-up; for V1 we expect the agent to be set to pcm_16000
            // (matches our microphone capture and Python SDK default).
            if let Ok(rate) = playback::parse_pcm_format(&meta.agent_output_audio_format) {
                if rate != playback.output_sample_rate() {
                    log::warn!(
                        "voice/client: agent output {rate}Hz != playback stream {}Hz — audio may pitch-shift; restart with matching rate or implement resampling.",
                        playback.output_sample_rate()
                    );
                }
            }
            callbacks.on_init(&meta.conversation_id, &meta.agent_output_audio_format);
        }

        ServerEvent::Audio { audio_event: ev } => {
            if playback.is_audio_stale(ev.event_id) {
                log::trace!("voice/client: drop stale audio event_id={}", ev.event_id);
                return;
            }
            if let Err(err) = playback.push_base64(&ev.audio_base_64) {
                log::warn!("voice/client: audio decode failed: {err}");
                return;
            }
            if !*first_audio_fired {
                *first_audio_fired = true;
                callbacks.on_first_audio();
            }
        }

        ServerEvent::AgentResponse {
            agent_response_event: ev,
        } => callbacks.on_agent_response(ev.agent_response.trim()),

        ServerEvent::AgentResponseCorrection {
            agent_response_correction_event: ev,
        } => callbacks.on_agent_response_correction(
            ev.original_agent_response.trim(),
            ev.corrected_agent_response.trim(),
        ),

        ServerEvent::AgentChatResponsePart { .. } => {
            // Text-streaming chunks for text-only sessions; voice sessions get
            // `AgentResponse` once the full text is composed. Ignored here.
        }

        ServerEvent::UserTranscript {
            user_transcription_event: ev,
        } => callbacks.on_user_transcript(ev.user_transcript.trim()),

        ServerEvent::Interruption { interruption_event: ev } => {
            playback.interrupt(ev.event_id);
            callbacks.on_interruption(ev.event_id);
        }

        ServerEvent::Ping { ping_event: ev } => {
            // Bounce the pong through the command channel so it serializes
            // with other outbound writes (single sink owner = the select! loop).
            let _ = commands_tx.send(ClientCommand::SendPong {
                event_id: ev.event_id,
            });
            if let Some(ms) = ev.ping_ms {
                log::trace!("voice/client: ping ({ms}ms)");
            }
        }

        ServerEvent::ClientToolCall { client_tool_call: ev } => {
            callbacks.on_client_tool_call(&ev.tool_name, &ev.tool_call_id, &ev.parameters);
        }

        ServerEvent::AgentToolResponse { agent_tool_response: ev } => {
            log::debug!(
                "voice/client: agent_tool_response name={} id={} err={}",
                ev.tool_name,
                ev.tool_call_id,
                ev.is_error
            );
        }

        ServerEvent::AgentResponseMetadata {
            agent_response_metadata_event: ev,
        } => {
            log::debug!("voice/client: agent metadata: {:?}", ev.metadata);
        }

        ServerEvent::VadScore { vad_score_event: ev } => {
            callbacks.on_vad_score(ev.vad_score);
        }

        ServerEvent::Unknown => {
            log::debug!("voice/client: ignored unknown server event");
        }
    }
}

async fn send_json<S>(sink: &mut S, evt: &ClientEvent<'_>) -> Result<()>
where
    S: SinkExt<Message> + Unpin,
    <S as futures_util::Sink<Message>>::Error: std::fmt::Display,
{
    let json = serde_json::to_string(evt).context("serialize client event")?;
    sink.send(Message::Text(json))
        .await
        .map_err(|e| anyhow!("send: {e}"))
}

fn build_initiation(config: &SessionConfig) -> String {
    let evt = ClientEvent::ConversationInitiationClientData {
        custom_llm_extra_body: config.custom_llm_extra_body.as_ref(),
        conversation_config_override: config.conversation_config_override.as_ref(),
        dynamic_variables: if config.dynamic_variables.is_empty() {
            None
        } else {
            Some(&config.dynamic_variables)
        },
        source_info: SourceInfo {
            source: SOURCE_NAME,
            version: SOURCE_VERSION,
        },
        user_id: config.user_id.as_deref(),
    };
    serde_json::to_string(&evt).expect("serialize init message")
}

async fn resolve_ws_url(config: &SessionConfig) -> Result<url::Url> {
    if let Some(api_key) = &config.api_key {
        return fetch_signed_url(&config.agent_id, api_key, config.environment.as_deref()).await;
    }
    let env_qs = config
        .environment
        .as_deref()
        .map(|e| format!("&environment={}", urlencoding(e)))
        .unwrap_or_default();
    let raw = format!(
        "wss://api.elevenlabs.io/v1/convai/conversation?agent_id={agent}&source={source}&version={version}{env_qs}",
        agent = urlencoding(&config.agent_id),
        source = SOURCE_NAME,
        version = SOURCE_VERSION,
    );
    url::Url::parse(&raw).map_err(|e| anyhow!("invalid ws url: {e}"))
}

async fn fetch_signed_url(
    agent_id: &str,
    api_key: &str,
    environment: Option<&str>,
) -> Result<url::Url> {
    let mut req_url = format!(
        "{base}/v1/convai/conversation/get-signed-url?agent_id={agent}",
        base = ELEVENLABS_BASE,
        agent = urlencoding(agent_id),
    );
    if let Some(env) = environment {
        req_url.push_str(&format!("&environment={}", urlencoding(env)));
    }

    let resp = reqwest::Client::new()
        .get(&req_url)
        .header("xi-api-key", api_key)
        .send()
        .await
        .context("get-signed-url request")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("get-signed-url {status}: {body}"));
    }
    #[derive(serde::Deserialize)]
    struct SignedUrlResponse {
        signed_url: String,
    }
    let parsed: SignedUrlResponse = resp.json().await.context("parse signed_url response")?;
    let mut signed = url::Url::parse(&parsed.signed_url).context("parse signed url")?;
    // Append source/version like the Python SDK does so analytics flow.
    signed
        .query_pairs_mut()
        .append_pair("source", SOURCE_NAME)
        .append_pair("version", SOURCE_VERSION);
    Ok(signed)
}

fn urlencoding(input: &str) -> String {
    // Minimal percent-encoder for the small set of URL-unsafe characters we
    // expect in agent_id / env strings. Avoids pulling another crate.
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencoding_handles_unsafe_chars() {
        assert_eq!(urlencoding("agent_abc.123"), "agent_abc.123");
        assert_eq!(urlencoding("a b/c"), "a%20b%2Fc");
    }

    #[test]
    fn init_message_serializes_minimally_without_vars() {
        let cfg = SessionConfig {
            agent_id: "agent_x".into(),
            api_key: None,
            environment: None,
            dynamic_variables: HashMap::new(),
            conversation_config_override: None,
            custom_llm_extra_body: None,
            user_id: None,
        };
        let msg = build_initiation(&cfg);
        assert!(msg.contains(r#""type":"conversation_initiation_client_data""#));
        assert!(msg.contains(r#""source":"atlas_desktop""#));
        assert!(!msg.contains("dynamic_variables"));
        assert!(!msg.contains("custom_llm_extra_body"));
        assert!(!msg.contains("conversation_config_override"));
        assert!(!msg.contains("user_id"));
    }

    #[test]
    fn init_message_includes_dynamic_vars() {
        let mut vars = HashMap::new();
        vars.insert("user_name".to_string(), Value::String("Aditya".to_string()));
        let cfg = SessionConfig {
            agent_id: "agent_x".into(),
            api_key: None,
            environment: None,
            dynamic_variables: vars,
            conversation_config_override: None,
            custom_llm_extra_body: None,
            user_id: Some("u_1".into()),
        };
        let msg = build_initiation(&cfg);
        assert!(msg.contains(r#""user_name":"Aditya""#));
        assert!(msg.contains(r#""user_id":"u_1""#));
    }
}
