#![allow(dead_code)] // accessor surface exported for future direct callers
//! Build-time-baked configuration with runtime env-var fallback.
//!
//! Path A (the judges build): CI sets four `ATLAS_BAKED_*` env vars at
//! `cargo build` time, `build.rs` writes them into a `bundled_config.rs`
//! generated module under `$OUT_DIR`, and this file re-exports them via
//! `include!`. Callers go through the `worker_url()`, `agent_token()`,
//! etc. accessors below, which prefer the **runtime** env (dev override)
//! and fall through to the baked constant otherwise.
//!
//! Dev builds — where no `ATLAS_BAKED_*` are set — emit empty constants
//! and the accessors fall through to `std::env::var`. Behavior matches
//! pre-baking exactly when nothing is baked.

mod generated {
    include!(concat!(env!("OUT_DIR"), "/bundled_config.rs"));
}

/// True if at least one bake-time secret was present. Pure diagnostic;
/// runtime accessors don't gate on it.
pub fn baked() -> bool {
    generated::BAKED
}

/// Try `$ATLAS_WORKER_URL` from env first; fall back to the baked value.
/// Returns `None` if neither is set.
pub fn worker_url() -> Option<String> {
    prefer_env_else_baked("ATLAS_WORKER_URL", generated::WORKER_URL)
}

pub fn agent_token() -> Option<String> {
    prefer_env_else_baked("ATLAS_AGENT_TOKEN", generated::AGENT_TOKEN)
}

pub fn agent_id() -> Option<String> {
    prefer_env_else_baked("ATLAS_AGENT_ID", generated::AGENT_ID)
}

pub fn elevenlabs_api_key() -> Option<String> {
    prefer_env_else_baked("ELEVENLABS_API_KEY", generated::ELEVENLABS_API_KEY)
}

fn prefer_env_else_baked(env_name: &str, baked: &str) -> Option<String> {
    if let Ok(v) = std::env::var(env_name) {
        if !v.is_empty() {
            return Some(v);
        }
    }
    if !baked.is_empty() {
        return Some(baked.to_string());
    }
    None
}

/// Push baked values into `std::env` for child modules that already read
/// env vars (voice, IVC, vision_qa). Idempotent — never overwrites a
/// value the user explicitly set in `.env.local`.
///
/// Call once at app startup from `lib.rs::run_inner` before the wake /
/// voice / vision subsystems start.
pub fn hydrate_env_from_baked() {
    set_if_unset("ATLAS_WORKER_URL", generated::WORKER_URL);
    set_if_unset("ATLAS_AGENT_TOKEN", generated::AGENT_TOKEN);
    set_if_unset("ATLAS_AGENT_ID", generated::AGENT_ID);
    set_if_unset("ELEVENLABS_API_KEY", generated::ELEVENLABS_API_KEY);
}

fn set_if_unset(name: &str, value: &str) {
    if value.is_empty() {
        return;
    }
    // `std::env::var` returns `Err` for unset; "" doesn't happen for our
    // keys but treat it the same to be defensive.
    let current = std::env::var(name).unwrap_or_default();
    if current.is_empty() {
        // SAFETY: in Tauri's main thread before any other threads spawn —
        // env mutation here is sound. After `hydrate_env_from_baked`
        // returns, all subsequent reads observe the baked value.
        unsafe {
            std::env::set_var(name, value);
        }
    }
}
