//! Wire types for the ElevenLabs Conversational Agent WebSocket.
//!
//! Authoritative source: <https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/conversational_ai/conversation.py>
//!
//! Events are externally-tagged on `type`. The payload for each event lives
//! inside a per-event wrapper object (e.g. `audio_event`, `ping_event`,
//! `user_transcription_event`). The only outgoing message that breaks this
//! pattern is `user_audio_chunk`, which is sent as `{user_audio_chunk: "<b64>"}`
//! with no `type` field — we model it as a separate function in `client.rs`
//! rather than as an enum variant.
//!
//! Some fields below aren't consumed by Phase 0.E (alignment, ping_ms,
//! event_ids, tool_type, …) but are part of the external API contract; we
//! deserialize them now so we don't have to refactor for Phase 1+ feature
//! additions.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

// ─────────────────────── Server → Client ───────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerEvent {
    ConversationInitiationMetadata {
        conversation_initiation_metadata_event: ConversationInitiationMetadata,
    },
    Audio {
        audio_event: AudioEvent,
    },
    AgentResponse {
        agent_response_event: AgentResponseEvent,
    },
    AgentResponseCorrection {
        agent_response_correction_event: AgentResponseCorrectionEvent,
    },
    AgentChatResponsePart {
        text_response_part: TextResponsePart,
    },
    UserTranscript {
        user_transcription_event: UserTranscriptionEvent,
    },
    Interruption {
        interruption_event: InterruptionEvent,
    },
    Ping {
        ping_event: PingEvent,
    },
    ClientToolCall {
        client_tool_call: ClientToolCall,
    },
    AgentToolResponse {
        agent_tool_response: AgentToolResponse,
    },
    AgentResponseMetadata {
        agent_response_metadata_event: AgentResponseMetadataEvent,
    },
    VadScore {
        vad_score_event: VadScoreEvent,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConversationInitiationMetadata {
    pub conversation_id: String,
    /// Sample-rate-tagged format, e.g. "pcm_16000" or "pcm_44100".
    pub agent_output_audio_format: String,
    pub user_input_audio_format: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AudioEvent {
    pub audio_base_64: String,
    pub event_id: u64,
    #[serde(default)]
    pub alignment: Option<AudioAlignment>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AudioAlignment {
    #[serde(default)]
    pub chars: Vec<String>,
    #[serde(default)]
    pub char_start_times_ms: Vec<i64>,
    #[serde(default)]
    pub char_durations_ms: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentResponseEvent {
    pub agent_response: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentResponseCorrectionEvent {
    pub original_agent_response: String,
    pub corrected_agent_response: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentChatResponsePartType {
    Start,
    Delta,
    Stop,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TextResponsePart {
    #[serde(rename = "type")]
    pub part_type: AgentChatResponsePartType,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub event_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UserTranscriptionEvent {
    pub user_transcript: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InterruptionEvent {
    pub event_id: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PingEvent {
    pub event_id: u64,
    #[serde(default)]
    pub ping_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClientToolCall {
    pub tool_name: String,
    pub tool_call_id: String,
    #[serde(default)]
    pub parameters: HashMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentToolResponse {
    pub tool_name: String,
    pub tool_call_id: String,
    #[serde(default)]
    pub tool_type: Option<String>,
    #[serde(default)]
    pub is_error: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentResponseMetadataEvent {
    pub metadata: HashMap<String, Value>,
    #[serde(default)]
    pub event_id: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VadScoreEvent {
    pub vad_score: f32,
}

// ─────────────────────── Client → Server ───────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientEvent<'a> {
    /// Sent once after the WebSocket opens. Carries dynamic variables and any
    /// per-call config overrides (voice id, language, etc.).
    ConversationInitiationClientData {
        #[serde(skip_serializing_if = "Option::is_none")]
        custom_llm_extra_body: Option<&'a Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        conversation_config_override: Option<&'a Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        dynamic_variables: Option<&'a HashMap<String, Value>>,
        source_info: SourceInfo<'a>,
        #[serde(skip_serializing_if = "Option::is_none")]
        user_id: Option<&'a str>,
    },
    Pong {
        event_id: u64,
    },
    ClientToolResult {
        tool_call_id: String,
        result: String,
        is_error: bool,
    },
    UserMessage {
        text: &'a str,
    },
    ContextualUpdate {
        text: &'a str,
    },
    UserActivity {},
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceInfo<'a> {
    pub source: &'a str,
    pub version: &'a str,
}

// ─────────────────────── parse / serialize helpers ───────────────────────

/// Parse a JSON text frame into a `ServerEvent`. Returns the event plus the
/// raw payload (useful for telemetry / unrecognized event logging).
pub fn parse_server_event(text: &str) -> Result<ServerEvent, serde_json::Error> {
    serde_json::from_str(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_init_metadata() {
        let raw = r#"{
            "type": "conversation_initiation_metadata",
            "conversation_initiation_metadata_event": {
                "conversation_id": "conv_abc",
                "agent_output_audio_format": "pcm_16000",
                "user_input_audio_format": "pcm_16000"
            }
        }"#;
        let parsed = parse_server_event(raw).unwrap();
        match parsed {
            ServerEvent::ConversationInitiationMetadata {
                conversation_initiation_metadata_event,
            } => {
                assert_eq!(conversation_initiation_metadata_event.conversation_id, "conv_abc");
                assert_eq!(
                    conversation_initiation_metadata_event.agent_output_audio_format,
                    "pcm_16000"
                );
            }
            other => panic!("unexpected variant: {:?}", other),
        }
    }

    #[test]
    fn parses_audio_event() {
        let raw = r#"{
            "type": "audio",
            "audio_event": {
                "audio_base_64": "AAAA",
                "event_id": 42
            }
        }"#;
        let parsed = parse_server_event(raw).unwrap();
        match parsed {
            ServerEvent::Audio { audio_event } => {
                assert_eq!(audio_event.audio_base_64, "AAAA");
                assert_eq!(audio_event.event_id, 42);
                assert!(audio_event.alignment.is_none());
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_ping() {
        let raw = r#"{"type":"ping","ping_event":{"event_id":7,"ping_ms":120}}"#;
        let parsed = parse_server_event(raw).unwrap();
        match parsed {
            ServerEvent::Ping { ping_event } => {
                assert_eq!(ping_event.event_id, 7);
                assert_eq!(ping_event.ping_ms, Some(120));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_user_transcript() {
        let raw = r#"{
            "type": "user_transcript",
            "user_transcription_event": { "user_transcript": "hello" }
        }"#;
        match parse_server_event(raw).unwrap() {
            ServerEvent::UserTranscript {
                user_transcription_event,
            } => assert_eq!(user_transcription_event.user_transcript, "hello"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn parses_client_tool_call() {
        let raw = r#"{
            "type": "client_tool_call",
            "client_tool_call": {
                "tool_name": "web_search",
                "tool_call_id": "call_1",
                "parameters": { "q": "lagos" }
            }
        }"#;
        match parse_server_event(raw).unwrap() {
            ServerEvent::ClientToolCall { client_tool_call } => {
                assert_eq!(client_tool_call.tool_name, "web_search");
                assert_eq!(client_tool_call.tool_call_id, "call_1");
                assert_eq!(client_tool_call.parameters.len(), 1);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn unknown_event_is_swallowed() {
        let raw = r#"{"type":"future_event","weird_event":{"x":1}}"#;
        let parsed = parse_server_event(raw).unwrap();
        matches!(parsed, ServerEvent::Unknown);
    }

    #[test]
    fn serializes_pong() {
        let evt = ClientEvent::Pong { event_id: 7 };
        let json = serde_json::to_string(&evt).unwrap();
        assert_eq!(json, r#"{"type":"pong","event_id":7}"#);
    }

    #[test]
    fn serializes_initiation_with_dynamic_vars() {
        let mut vars = HashMap::new();
        vars.insert("user_name".to_string(), Value::String("Aditya".to_string()));
        let evt = ClientEvent::ConversationInitiationClientData {
            custom_llm_extra_body: None,
            conversation_config_override: None,
            dynamic_variables: Some(&vars),
            source_info: SourceInfo {
                source: "atlas_desktop",
                version: "0.0.1",
            },
            user_id: None,
        };
        let json = serde_json::to_string(&evt).unwrap();
        assert!(json.contains(r#""type":"conversation_initiation_client_data""#));
        assert!(json.contains(r#""dynamic_variables":{"user_name":"Aditya"}"#));
        assert!(json.contains(r#""source":"atlas_desktop""#));
        // Confirm Option::None fields are stripped.
        assert!(!json.contains("custom_llm_extra_body"));
        assert!(!json.contains("user_id"));
    }

    #[test]
    fn serializes_client_tool_result() {
        let evt = ClientEvent::ClientToolResult {
            tool_call_id: "call_1".into(),
            result: "42".into(),
            is_error: false,
        };
        let json = serde_json::to_string(&evt).unwrap();
        assert_eq!(
            json,
            r#"{"type":"client_tool_result","tool_call_id":"call_1","result":"42","is_error":false}"#
        );
    }

    #[test]
    fn serializes_user_activity_as_type_only() {
        let evt = ClientEvent::UserActivity {};
        let json = serde_json::to_string(&evt).unwrap();
        assert_eq!(json, r#"{"type":"user_activity"}"#);
    }
}
