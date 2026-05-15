//! `battery_status` — report charge level and whether the machine is on power.
//!
//! Linux  → `/sys/class/power_supply/BAT*` (capacity + status files).
//! macOS  → `pmset -g batt`.
//! Windows → PowerShell `Get-CimInstance Win32_Battery`.
//!
//! Desktops with no battery return `{present: false}` — the agent should say
//! "this machine doesn't have a battery" rather than guess.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

use super::ToolResult;

pub fn execute<R: Runtime>(_app: &AppHandle<R>, _parameters: &Value) -> ToolResult {
    match read_battery() {
        Ok(info) => ToolResult::ok(json!({
            "present": info.present,
            "percent": info.percent,
            "charging": info.charging,
        })),
        Err(err) => ToolResult::err(format!("battery_status: {err:#}")),
    }
}

struct BatteryInfo {
    present: bool,
    /// 0-100, or `None` if it couldn't be read.
    percent: Option<i64>,
    charging: bool,
}

#[cfg(target_os = "linux")]
fn read_battery() -> Result<BatteryInfo> {
    use std::fs;
    let dir = fs::read_dir("/sys/class/power_supply").context("read /sys/class/power_supply")?;
    for ent in dir.flatten() {
        let name = ent.file_name();
        if !name.to_string_lossy().starts_with("BAT") {
            continue;
        }
        let base = ent.path();
        let percent = fs::read_to_string(base.join("capacity"))
            .ok()
            .and_then(|s| s.trim().parse::<i64>().ok());
        let status = fs::read_to_string(base.join("status"))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let charging =
            status.eq_ignore_ascii_case("Charging") || status.eq_ignore_ascii_case("Full");
        return Ok(BatteryInfo {
            present: true,
            percent,
            charging,
        });
    }
    Ok(BatteryInfo {
        present: false,
        percent: None,
        charging: false,
    })
}

#[cfg(target_os = "macos")]
fn read_battery() -> Result<BatteryInfo> {
    use std::process::Command;
    let out = Command::new("/usr/bin/pmset")
        .args(["-g", "batt"])
        .output()
        .context("pmset -g batt")?;
    let text = String::from_utf8_lossy(&out.stdout);
    if !text.contains("InternalBattery") {
        return Ok(BatteryInfo {
            present: false,
            percent: None,
            charging: false,
        });
    }
    // pmset prints e.g. "... -InternalBattery-0 (id=...)\t87%; discharging; ..."
    let percent = text.find('%').and_then(|i| {
        let prefix = &text[..i];
        let start = prefix
            .rfind(|c: char| !c.is_ascii_digit())
            .map(|x| x + 1)
            .unwrap_or(0);
        prefix[start..].parse::<i64>().ok()
    });
    let charging = text.contains("; charging") || text.contains("; charged");
    Ok(BatteryInfo {
        present: true,
        percent,
        charging,
    })
}

#[cfg(target_os = "windows")]
fn read_battery() -> Result<BatteryInfo> {
    use std::process::Command;
    // EstimatedChargeRemaining = %, BatteryStatus 2 = running on AC power.
    let script = "$b = Get-CimInstance Win32_Battery | Select-Object -First 1; \
         if ($b) { \"$($b.EstimatedChargeRemaining)|$($b.BatteryStatus)\" } else { 'none' }";
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .context("powershell Win32_Battery")?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() || text == "none" {
        return Ok(BatteryInfo {
            present: false,
            percent: None,
            charging: false,
        });
    }
    let mut parts = text.split('|');
    let percent = parts.next().and_then(|s| s.trim().parse::<i64>().ok());
    let status = parts.next().and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0);
    Ok(BatteryInfo {
        present: true,
        percent,
        charging: status == 2,
    })
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn read_battery() -> Result<BatteryInfo> {
    Ok(BatteryInfo {
        present: false,
        percent: None,
        charging: false,
    })
}
