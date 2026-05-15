//! `system_action` client tool — volume, mute, brightness, DND, sleep.
//!
//! macOS implementations via osascript and pmset:
//!   volume_up / volume_down → osascript adjusts `sound volume` by ±5.
//!   mute → toggle `sound volume` to 0 or back to last-known.
//!   brightness_up / brightness_down → AppleScript `System Events` keystrokes
//!     (F1/F2). Less reliable than `nvram` writes but doesn't need
//!     entitlements.
//!   dnd_on / dnd_off → AppleScript Shortcut bridge (Focus). Best-effort.
//!   display_sleep → `pmset displaysleepnow`.
//!
//! Linux uses pactl + brightnessctl + gsettings + xset (the dev-plan §5.5
//! shape).

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::Command;
use tauri::{AppHandle, Runtime};

use super::ToolResult;

#[derive(Debug, Deserialize)]
struct SystemInput {
    action: String,
    #[serde(default)]
    value: Option<f64>,
}

pub fn execute<R: Runtime>(_app: &AppHandle<R>, parameters: &Value) -> ToolResult {
    let input: SystemInput = match serde_json::from_value(parameters.clone()) {
        Ok(v) => v,
        Err(err) => return ToolResult::err(format!("system_action: invalid parameters: {err}")),
    };
    match dispatch(&input.action, input.value) {
        Ok(status) => ToolResult::ok(json!({ "executed": true, "status": status })),
        Err(err) => ToolResult::err(format!("system_action: {err}")),
    }
}

#[cfg(target_os = "macos")]
fn dispatch(action: &str, value: Option<f64>) -> Result<String> {
    let step = value.unwrap_or(5.0).clamp(0.0, 100.0);
    match action {
        "volume_up" => run_osa(&format!(
            "set volume output volume ((output volume of (get volume settings)) + {step})"
        )),
        "volume_down" => run_osa(&format!(
            "set volume output volume ((output volume of (get volume settings)) - {step})"
        )),
        "mute" => run_osa("set volume with output muted"),
        "brightness_up" => run_osa(
            r#"tell application "System Events" to key code 144"#, // F2 ↑
        ),
        "brightness_down" => run_osa(
            r#"tell application "System Events" to key code 145"#, // F1 ↓
        ),
        "display_sleep" => {
            Command::new("/usr/bin/pmset")
                .arg("displaysleepnow")
                .status()
                .context("pmset displaysleepnow")?;
            Ok("display sleeping".to_string())
        }
        "dnd_on" => Err(anyhow!(
            "macOS Focus modes need a per-user Shortcut — not wired in V1; defer to System Settings."
        )),
        "dnd_off" => Err(anyhow!(
            "macOS Focus modes need a per-user Shortcut — not wired in V1; defer to System Settings."
        )),
        other => Err(anyhow!("unknown action '{other}'")),
    }
}

#[cfg(target_os = "macos")]
fn run_osa(script: &str) -> Result<String> {
    let out = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .context("osascript")?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(anyhow!("osascript failed: {stderr}"));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(target_os = "linux")]
fn dispatch(action: &str, value: Option<f64>) -> Result<String> {
    let step = value.unwrap_or(5.0).clamp(0.0, 100.0);
    match action {
        "volume_up" => sh(&format!("pactl set-sink-volume @DEFAULT_SINK@ +{step}%")),
        "volume_down" => sh(&format!("pactl set-sink-volume @DEFAULT_SINK@ -{step}%")),
        "mute" => sh("pactl set-sink-mute @DEFAULT_SINK@ toggle"),
        "brightness_up" => sh(&format!("brightnessctl set +{step}%")),
        "brightness_down" => sh(&format!("brightnessctl set {step}%-")),
        "dnd_on" => sh("gsettings set org.gnome.desktop.notifications show-banners false"),
        "dnd_off" => sh("gsettings set org.gnome.desktop.notifications show-banners true"),
        "display_sleep" => sh("xset dpms force off || loginctl lock-session"),
        other => Err(anyhow!("unknown action '{other}'")),
    }
}

#[cfg(target_os = "linux")]
fn sh(cmd: &str) -> Result<String> {
    let out = Command::new("/bin/sh")
        .arg("-c")
        .arg(cmd)
        .output()
        .context("sh")?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(anyhow!("'{cmd}' failed: {stderr}"));
    }
    Ok(cmd.to_string())
}

#[cfg(target_os = "windows")]
fn dispatch(action: &str, value: Option<f64>) -> Result<String> {
    let step = value.unwrap_or(5.0).clamp(0.0, 100.0);
    match action {
        // Volume: WScript.Shell SendKeys understands the media-key char codes
        // (174 = down, 175 = up, 173 = mute). Each press moves ~2%, so repeat
        // roughly `step / 2` times to honour the requested step.
        "volume_up" => {
            let presses = ((step / 2.0).round() as i64).max(1);
            send_media_key(175, presses)?;
            Ok(format!("volume up x{presses}"))
        }
        "volume_down" => {
            let presses = ((step / 2.0).round() as i64).max(1);
            send_media_key(174, presses)?;
            Ok(format!("volume down x{presses}"))
        }
        "mute" => {
            send_media_key(173, 1)?;
            Ok("mute toggled".to_string())
        }
        // Brightness via the WMI monitor-brightness method (laptop panels).
        "brightness_up" => set_brightness_delta(step),
        "brightness_down" => set_brightness_delta(-step),
        // Monitor off via the classic WM_SYSCOMMAND / SC_MONITORPOWER message.
        "display_sleep" => {
            ps("(Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static \
                extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);' \
                -Name Native -Namespace Win32 -PassThru)::SendMessage(-1, 0x0112, 0xF170, 2)")?;
            Ok("display sleeping".to_string())
        }
        "dnd_on" | "dnd_off" => Err(anyhow!(
            "Windows Focus Assist has no stable CLI toggle — change it from the Action Center."
        )),
        other => Err(anyhow!("unknown action '{other}'")),
    }
}

/// Run a PowerShell one-liner, returning its trimmed stdout.
#[cfg(target_os = "windows")]
fn ps(script: &str) -> Result<String> {
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .context("powershell")?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(anyhow!("powershell failed: {stderr}"));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Send a media virtual-key `count` times via WScript.Shell SendKeys.
#[cfg(target_os = "windows")]
fn send_media_key(char_code: u32, count: i64) -> Result<String> {
    let script = format!(
        "$w = New-Object -ComObject WScript.Shell; \
         1..{count} | ForEach-Object {{ $w.SendKeys([char]{char_code}) }}"
    );
    ps(&script)
}

/// Nudge laptop-panel brightness by `delta` percent (clamped 0-100).
#[cfg(target_os = "windows")]
fn set_brightness_delta(delta: f64) -> Result<String> {
    let script = format!(
        "$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness; \
         $cur = $m.CurrentBrightness; \
         $new = [Math]::Max(0, [Math]::Min(100, $cur + ({delta}))); \
         Invoke-CimMethod -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods \
         -MethodName WmiSetBrightness -Arguments @{{Brightness=[byte]$new; Timeout=[uint32]0}} | Out-Null; \
         \"brightness $new\""
    );
    ps(&script).map_err(|e| anyhow!("brightness control needs a laptop panel: {e}"))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn dispatch(_action: &str, _value: Option<f64>) -> Result<String> {
    Err(anyhow!("system_action: unsupported platform"))
}
