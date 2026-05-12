//! Voice preferences persistence.
//!
//! Holds the user's chosen IVC voice id + display name + which onboarding
//! step they're on. Backed by `tauri-plugin-store`; survives restarts.
//! Lives at the OS-native config dir
//! (`~/.config/com.atlas.desktop/preferences.json` on Linux).

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::{Store, StoreExt};

const STORE_FILE: &str = "preferences.json";
const KEY_VOICE_ID: &str = "voice.id";
const KEY_VOICE_NAME: &str = "voice.name";
const KEY_VOICE_SOURCE: &str = "voice.source";
const KEY_ONBOARDING_COMPLETED: &str = "onboarding.completed";

/// User's active voice. Returned to the frontend on app launch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoicePreferences {
    pub voice_id: Option<String>,
    pub voice_name: Option<String>,
    /// `stock` | `cloned_record` | `cloned_upload`
    pub voice_source: Option<String>,
    pub onboarding_completed: bool,
}

pub fn read<R: Runtime>(app: &AppHandle<R>) -> Result<VoicePreferences> {
    let store = open(app)?;
    Ok(VoicePreferences {
        voice_id: store.get(KEY_VOICE_ID).and_then(value_to_string),
        voice_name: store.get(KEY_VOICE_NAME).and_then(value_to_string),
        voice_source: store.get(KEY_VOICE_SOURCE).and_then(value_to_string),
        onboarding_completed: store
            .get(KEY_ONBOARDING_COMPLETED)
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

pub fn write_voice<R: Runtime>(
    app: &AppHandle<R>,
    voice_id: &str,
    voice_name: &str,
    source: &str,
) -> Result<()> {
    let store = open(app)?;
    store.set(KEY_VOICE_ID, Value::String(voice_id.to_string()));
    store.set(KEY_VOICE_NAME, Value::String(voice_name.to_string()));
    store.set(KEY_VOICE_SOURCE, Value::String(source.to_string()));
    store.save().context("store save")?;
    log::info!("preferences: voice set to '{voice_name}' ({voice_id}) via {source}");
    Ok(())
}

pub fn mark_onboarding_complete<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let store = open(app)?;
    store.set(KEY_ONBOARDING_COMPLETED, Value::Bool(true));
    store.save().context("store save")?;
    Ok(())
}

/// Reset everything voice/onboarding-related. Used by "Pick a new voice" or
/// the "Reset Atlas" panic toggle.
pub fn reset<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let store = open(app)?;
    store.delete(KEY_VOICE_ID);
    store.delete(KEY_VOICE_NAME);
    store.delete(KEY_VOICE_SOURCE);
    store.delete(KEY_ONBOARDING_COMPLETED);
    store.save().context("store save")?;
    log::info!("preferences: reset");
    Ok(())
}

fn open<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<Store<R>>> {
    app.store(STORE_FILE)
        .map_err(|e| anyhow!("open store: {e}"))
}

fn value_to_string(v: Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn value_to_string_handles_empty_and_other_types() {
        assert_eq!(value_to_string(json!("hi")), Some("hi".to_string()));
        assert_eq!(value_to_string(json!("")), None);
        assert_eq!(value_to_string(json!(42)), None);
        assert_eq!(value_to_string(json!(null)), None);
    }
}
