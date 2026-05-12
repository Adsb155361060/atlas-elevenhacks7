//! Authoritative state machine for the conversation lifecycle.
//!
//! The five UI states map to lifecycle phases of a voice turn:
//!   Idle      — no active conversation; tray pulsing optional
//!   Listening — wake fired, mic streaming to ElevenLabs
//!   Thinking  — STT done, Worker / Claude composing
//!   Speaking  — Flash v2.5 audio streaming back to the user
//!   Paused    — user disabled the wake word; only push-to-talk works
//!
//! Held in a `tokio::sync::watch` channel so we can subscribe from anywhere
//! in the Rust backend without contention. Every transition also emits the
//! `atlas:state` event so the frontend can mirror it.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::watch;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AtlasState {
    Idle,
    Listening,
    Thinking,
    Speaking,
    Paused,
}

impl AtlasState {
    pub fn as_str(&self) -> &'static str {
        match self {
            AtlasState::Idle => "idle",
            AtlasState::Listening => "listening",
            AtlasState::Thinking => "thinking",
            AtlasState::Speaking => "speaking",
            AtlasState::Paused => "paused",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "idle" => Some(AtlasState::Idle),
            "listening" => Some(AtlasState::Listening),
            "thinking" => Some(AtlasState::Thinking),
            "speaking" => Some(AtlasState::Speaking),
            "paused" => Some(AtlasState::Paused),
            _ => None,
        }
    }
}

pub struct StateChannel {
    pub tx: watch::Sender<AtlasState>,
    pub rx: watch::Receiver<AtlasState>,
}

pub fn init<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    let (tx, rx) = watch::channel(AtlasState::Idle);
    app.manage(StateChannel { tx, rx });
    // Emit the initial state so any already-subscribed frontend listener sees it.
    let _ = app.emit("atlas:state", AtlasState::Idle.as_str());
    Ok(())
}

pub fn set<R: Runtime>(app: &AppHandle<R>, new_state: AtlasState) -> Result<()> {
    let channel = app.state::<StateChannel>();
    channel.tx.send(new_state)?;
    app.emit("atlas:state", new_state.as_str())?;
    log::debug!("atlas:state -> {}", new_state.as_str());
    Ok(())
}

pub fn current<R: Runtime>(app: &AppHandle<R>) -> AtlasState {
    let channel = app.state::<StateChannel>();
    let value = *channel.rx.borrow();
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_string_repr() {
        for s in [
            AtlasState::Idle,
            AtlasState::Listening,
            AtlasState::Thinking,
            AtlasState::Speaking,
            AtlasState::Paused,
        ] {
            assert_eq!(AtlasState::parse(s.as_str()), Some(s));
        }
    }

    #[test]
    fn unknown_state_is_none() {
        assert_eq!(AtlasState::parse("nope"), None);
        assert_eq!(AtlasState::parse(""), None);
    }
}
