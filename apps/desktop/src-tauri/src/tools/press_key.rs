//! `press_key` — send a keyboard shortcut to whatever has focus.
//!
//! Phase 4.4 companion to `type_text`. Cross-platform shortcut notation:
//!   `mod+mod+…+key` where mod is one of `cmd | ctrl | alt | shift | super`
//!   and key is a single letter/digit or a named key
//!   (`enter|tab|space|escape|backspace|delete|home|end|pageup|pagedown|
//!    up|down|left|right|insert|f1`…`f24`).
//!
//! `cmd` means "the primary accelerator key" — ⌘ on macOS, Ctrl on Windows
//! and Linux. `ctrl` always means literal Ctrl. This matches Tauri's
//! `CommandOrControl` convention, so the agent can say `cmd+s` and have
//! Save work everywhere.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::Command;
use tauri::{AppHandle, Runtime};

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct PressInput {
    /// `cmd+s`, `alt+f4`, `enter`, `ctrl+shift+t`, … (case-insensitive).
    keys: String,
}

pub fn execute<R: Runtime>(_app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: PressInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("press_key: invalid parameters: {err}")),
    };
    let parsed = match parse_combo(&input.keys) {
        Ok(p) => p,
        Err(err) => return ToolResult::err(format!("press_key: {err}")),
    };
    match send(&parsed) {
        Ok(()) => {
            log::info!("press_key: sent '{}'", input.keys);
            ToolResult::ok(json!({ "pressed": true, "keys": input.keys }))
        }
        Err(err) => ToolResult::err(format!("press_key: {err:#}")),
    }
}

// ───────────────────────── parsing ─────────────────────────

#[derive(Debug, Default, PartialEq, Eq)]
struct ModSet {
    /// "primary accelerator" — ⌘ on macOS, Ctrl on Windows/Linux.
    cmd: bool,
    ctrl: bool,
    alt: bool,
    shift: bool,
    super_: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum KeyCode {
    /// A single typeable character (letter or digit). Stored lowercase.
    Char(char),
    Named(NamedKey),
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum NamedKey {
    Return,
    Tab,
    Space,
    Escape,
    Backspace,
    Delete,
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    PageUp,
    PageDown,
    Insert,
    F(u8),
}

#[derive(Debug)]
struct Combo {
    mods: ModSet,
    key: KeyCode,
}

fn parse_combo(input: &str) -> Result<Combo> {
    let s = input.trim();
    if s.is_empty() {
        return Err(anyhow!("'keys' is required"));
    }
    let parts: Vec<&str> = s.split('+').map(str::trim).filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return Err(anyhow!("'keys' parsed to nothing"));
    }
    let mut mods = ModSet::default();
    for m in &parts[..parts.len() - 1] {
        match m.to_ascii_lowercase().as_str() {
            "cmd" | "command" | "meta" => mods.cmd = true,
            "ctrl" | "control" => mods.ctrl = true,
            "alt" | "option" | "opt" => mods.alt = true,
            "shift" => mods.shift = true,
            "super" | "win" | "windows" => mods.super_ = true,
            other => return Err(anyhow!("unknown modifier '{other}'")),
        }
    }
    let key = parse_key(parts.last().unwrap())?;
    Ok(Combo { mods, key })
}

fn parse_key(s: &str) -> Result<KeyCode> {
    let lower = s.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix('f') {
        if let Ok(n) = rest.parse::<u8>() {
            if (1..=24).contains(&n) {
                return Ok(KeyCode::Named(NamedKey::F(n)));
            }
        }
    }
    let named = match lower.as_str() {
        "enter" | "return" => Some(NamedKey::Return),
        "tab" => Some(NamedKey::Tab),
        "space" => Some(NamedKey::Space),
        "escape" | "esc" => Some(NamedKey::Escape),
        "backspace" | "bs" => Some(NamedKey::Backspace),
        "delete" | "del" => Some(NamedKey::Delete),
        "up" => Some(NamedKey::Up),
        "down" => Some(NamedKey::Down),
        "left" => Some(NamedKey::Left),
        "right" => Some(NamedKey::Right),
        "home" => Some(NamedKey::Home),
        "end" => Some(NamedKey::End),
        "pageup" | "pgup" => Some(NamedKey::PageUp),
        "pagedown" | "pgdn" => Some(NamedKey::PageDown),
        "insert" | "ins" => Some(NamedKey::Insert),
        _ => None,
    };
    if let Some(n) = named {
        return Ok(KeyCode::Named(n));
    }
    let mut chars = lower.chars();
    let first = chars.next();
    if chars.next().is_none() {
        if let Some(c) = first {
            if c.is_ascii_alphanumeric() {
                return Ok(KeyCode::Char(c));
            }
        }
    }
    Err(anyhow!("unrecognised key '{s}'"))
}

// ───────────────────────── per-OS senders ─────────────────────────

#[cfg(target_os = "macos")]
fn send(c: &Combo) -> Result<()> {
    // macOS: System Events. `cmd` and `super` both map to command. `alt` is
    // option. We emit `keystroke "x"` for letters/digits, `key code N` for
    // named keys.
    let mut mods: Vec<&str> = Vec::new();
    if c.mods.cmd || c.mods.super_ {
        mods.push("command down");
    }
    if c.mods.ctrl {
        mods.push("control down");
    }
    if c.mods.alt {
        mods.push("option down");
    }
    if c.mods.shift {
        mods.push("shift down");
    }
    let using = if mods.is_empty() {
        String::new()
    } else {
        format!(" using {{{}}}", mods.join(", "))
    };
    let inner = match &c.key {
        KeyCode::Char(ch) => format!("keystroke \"{ch}\""),
        KeyCode::Named(n) => format!("key code {}", mac_key_code(*n)?),
    };
    let script = format!(r#"tell application "System Events" to {inner}{using}"#);
    let out = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .context("osascript")?;
    if !out.status.success() {
        return Err(anyhow!(
            "osascript failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn mac_key_code(n: NamedKey) -> Result<u16> {
    Ok(match n {
        NamedKey::Return => 36,
        NamedKey::Tab => 48,
        NamedKey::Space => 49,
        NamedKey::Escape => 53,
        NamedKey::Backspace => 51,
        NamedKey::Delete => 117,
        NamedKey::Up => 126,
        NamedKey::Down => 125,
        NamedKey::Left => 123,
        NamedKey::Right => 124,
        NamedKey::Home => 115,
        NamedKey::End => 119,
        NamedKey::PageUp => 116,
        NamedKey::PageDown => 121,
        NamedKey::Insert => 114, // Help / Insert on full keyboards
        NamedKey::F(n) => match n {
            1 => 122, 2 => 120, 3 => 99, 4 => 118, 5 => 96, 6 => 97,
            7 => 98, 8 => 100, 9 => 101, 10 => 109, 11 => 103, 12 => 111,
            13 => 105, 14 => 107, 15 => 113, 16 => 106, 17 => 64, 18 => 79,
            19 => 80, 20 => 90,
            _ => return Err(anyhow!("F{n} not supported on macOS")),
        },
    })
}

#[cfg(target_os = "linux")]
fn send(c: &Combo) -> Result<()> {
    // xdotool's combo notation: mod+mod+key. `cmd` maps to ctrl (primary
    // accelerator on Linux), `super` maps to super, etc.
    let mut parts: Vec<String> = Vec::new();
    if c.mods.ctrl || c.mods.cmd {
        parts.push("ctrl".to_string());
    }
    if c.mods.alt {
        parts.push("alt".to_string());
    }
    if c.mods.shift {
        parts.push("shift".to_string());
    }
    if c.mods.super_ {
        parts.push("super".to_string());
    }
    parts.push(linux_key_name(&c.key));
    let combo = parts.join("+");

    let xdo = Command::new("xdotool").args(["key", &combo]).status();
    if let Ok(s) = xdo {
        if s.success() {
            return Ok(());
        }
    }
    // Wayland fallback. ydotool's key syntax is keycode-based (not nice).
    // Best-effort: try `ydotool key <combo>` (some ydotool builds parse
    // names); if it fails, surface a clear hint.
    let yd = Command::new("ydotool").args(["key", &combo]).status();
    if let Ok(s) = yd {
        if s.success() {
            return Ok(());
        }
    }
    Err(anyhow!(
        "neither xdotool (X11) nor ydotool (Wayland) succeeded for '{combo}' — install xdotool or wire up ydotool"
    ))
}

#[cfg(target_os = "linux")]
fn linux_key_name(k: &KeyCode) -> String {
    match k {
        KeyCode::Char(c) => c.to_string(),
        KeyCode::Named(n) => match n {
            NamedKey::Return => "Return",
            NamedKey::Tab => "Tab",
            NamedKey::Space => "space",
            NamedKey::Escape => "Escape",
            NamedKey::Backspace => "BackSpace",
            NamedKey::Delete => "Delete",
            NamedKey::Up => "Up",
            NamedKey::Down => "Down",
            NamedKey::Left => "Left",
            NamedKey::Right => "Right",
            NamedKey::Home => "Home",
            NamedKey::End => "End",
            NamedKey::PageUp => "Page_Up",
            NamedKey::PageDown => "Page_Down",
            NamedKey::Insert => "Insert",
            NamedKey::F(n) => return format!("F{n}"),
        }
        .to_string(),
    }
}

#[cfg(target_os = "windows")]
fn send(c: &Combo) -> Result<()> {
    // SendKeys notation: ^ = Ctrl, + = Shift, % = Alt. `cmd` maps to ^.
    // Win key (`super`) isn't supported by SendKeys; we warn but proceed.
    let mut prefix = String::new();
    if c.mods.ctrl || c.mods.cmd {
        prefix.push('^');
    }
    if c.mods.alt {
        prefix.push('%');
    }
    if c.mods.shift {
        prefix.push('+');
    }
    if c.mods.super_ {
        log::warn!("press_key: Windows key (super) is not supported by SendKeys; ignored");
    }
    let key = match &c.key {
        KeyCode::Char(ch) => ch.to_string(),
        KeyCode::Named(n) => windows_key_name(*n),
    };
    let combo = format!("{prefix}{key}");
    let ps_literal = combo.replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         [System.Windows.Forms.SendKeys]::SendWait('{ps_literal}')"
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .context("powershell SendKeys")?;
    if !out.status.success() {
        return Err(anyhow!(
            "SendKeys failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_key_name(n: NamedKey) -> String {
    match n {
        NamedKey::Return => "{ENTER}",
        NamedKey::Tab => "{TAB}",
        NamedKey::Space => " ",
        NamedKey::Escape => "{ESC}",
        NamedKey::Backspace => "{BACKSPACE}",
        NamedKey::Delete => "{DELETE}",
        NamedKey::Up => "{UP}",
        NamedKey::Down => "{DOWN}",
        NamedKey::Left => "{LEFT}",
        NamedKey::Right => "{RIGHT}",
        NamedKey::Home => "{HOME}",
        NamedKey::End => "{END}",
        NamedKey::PageUp => "{PGUP}",
        NamedKey::PageDown => "{PGDN}",
        NamedKey::Insert => "{INSERT}",
        NamedKey::F(n) => return format!("{{F{n}}}"),
    }
    .to_string()
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn send(_c: &Combo) -> Result<()> {
    Err(anyhow!("press_key: unsupported platform"))
}

// ───────────────────────── tests ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_letter() {
        let c = parse_combo("a").unwrap();
        assert_eq!(c.mods, ModSet::default());
        assert_eq!(c.key, KeyCode::Char('a'));
    }

    #[test]
    fn parses_cmd_letter() {
        let c = parse_combo("cmd+s").unwrap();
        assert!(c.mods.cmd && !c.mods.ctrl);
        assert_eq!(c.key, KeyCode::Char('s'));
    }

    #[test]
    fn parses_multi_modifier() {
        let c = parse_combo("CTRL+Shift+Alt+t").unwrap();
        assert!(c.mods.ctrl && c.mods.shift && c.mods.alt);
        assert!(!c.mods.cmd);
        assert_eq!(c.key, KeyCode::Char('t'));
    }

    #[test]
    fn parses_named_keys() {
        for (s, expected) in [
            ("Enter", NamedKey::Return),
            ("escape", NamedKey::Escape),
            ("pgup", NamedKey::PageUp),
            ("F12", NamedKey::F(12)),
        ] {
            let c = parse_combo(s).unwrap();
            assert_eq!(c.key, KeyCode::Named(expected));
        }
    }

    #[test]
    fn rejects_unknown() {
        assert!(parse_combo("xyz").is_err());
        assert!(parse_combo("cmd+banana").is_err());
        assert!(parse_combo("nope+s").is_err());
        assert!(parse_combo("F99").is_err());
        assert!(parse_combo("").is_err());
    }
}
