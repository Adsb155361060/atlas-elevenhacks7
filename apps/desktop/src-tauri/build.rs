use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    tauri_build::build();
    emit_bundled_config();
}

/// Write `$OUT_DIR/bundled_config.rs` with `pub const` strings for the
/// four runtime values judges need pre-baked. CI passes them in via
/// repo secrets at build time (`ATLAS_BAKED_*` env vars).
///
/// Dev builds — where the secrets aren't set — emit empty strings, and
/// `src/bundled.rs` falls back to `std::env::var` at runtime.
fn emit_bundled_config() {
    // Re-run if any of the bake-time env vars changes.
    for k in [
        "ATLAS_BAKED_WORKER_URL",
        "ATLAS_BAKED_AGENT_TOKEN",
        "ATLAS_BAKED_AGENT_ID",
        "ATLAS_BAKED_ELEVENLABS_API_KEY",
    ] {
        println!("cargo:rerun-if-env-changed={k}");
    }

    let worker_url = env::var("ATLAS_BAKED_WORKER_URL").unwrap_or_default();
    let agent_token = env::var("ATLAS_BAKED_AGENT_TOKEN").unwrap_or_default();
    let agent_id = env::var("ATLAS_BAKED_AGENT_ID").unwrap_or_default();
    let elevenlabs_key = env::var("ATLAS_BAKED_ELEVENLABS_API_KEY").unwrap_or_default();
    // Marker for runtime to detect whether ANY value was baked. If none
    // were, runtime stays in dev mode (env-var lookup only).
    let baked = !worker_url.is_empty()
        || !agent_token.is_empty()
        || !agent_id.is_empty()
        || !elevenlabs_key.is_empty();

    let out_dir = env::var("OUT_DIR").expect("OUT_DIR set by cargo");
    let out_path = PathBuf::from(out_dir).join("bundled_config.rs");
    let contents = format!(
        r##"// Generated at build time by build.rs. Do not edit by hand.
pub const BAKED: bool = {baked};
pub const WORKER_URL: &str = r#"{worker_url}"#;
pub const AGENT_TOKEN: &str = r#"{agent_token}"#;
pub const AGENT_ID: &str = r#"{agent_id}"#;
pub const ELEVENLABS_API_KEY: &str = r#"{elevenlabs_key}"#;
"##
    );
    fs::write(&out_path, contents).expect("write bundled_config.rs");
}
