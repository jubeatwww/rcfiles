//! Coding agent status for herdr.
//!
//! Publishes what an agent's session is doing (model, effort, context, cost, plan
//! limits, folder) as the herdr terminal label `agent.status`, which herdr-app
//! mods read live. One JSON object, always with `agent`; fields an agent doesn't
//! report are left out.
//!
//!   agent-status claude   Claude Code's statusLine command (the default).
//!   agent-status codex    A Codex hook: SessionStart, PostToolUse, Stop.
//!
//! Both read JSON on stdin. Outside herdr (no `HC_TERMINAL_ID`) nothing is
//! published; see each module for what it does instead.

mod claude;
mod codex;

use serde_json::{Map, Value};
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const LABEL: &str = "agent.status";

fn main() {
    let agent = std::env::args().nth(1).unwrap_or_else(|| "claude".into());
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        return;
    }
    let Ok(json) = serde_json::from_str::<Value>(&input) else {
        return;
    };
    let terminal = std::env::var("HC_TERMINAL_ID").ok().filter(|t| !t.is_empty());
    match agent.as_str() {
        "claude" => claude::run(&input, &json, terminal.as_deref()),
        "codex" => codex::run(&json, terminal.as_deref()),
        other => eprintln!("agent-status: unknown agent '{other}' (claude or codex)"),
    }
}

/// Sets the label, only when it changed: each `hc label` re-renders the app's mods.
fn publish(terminal: &str, summary: &Map<String, Value>) {
    let value = Value::Object(summary.clone()).to_string();
    let cache = cache_path(terminal);
    if std::fs::read_to_string(&cache).ok().as_deref() == Some(value.as_str()) {
        return;
    }
    let sent = Command::new("hc")
        .args(["label", terminal, &format!("{LABEL}={value}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if sent {
        if let Some(dir) = cache.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&cache, &value);
    }
}

/// The last value sent for this terminal, per herdr-core (its scope).
fn cache_path(terminal: &str) -> PathBuf {
    let scope = std::env::var("HC_SCOPE").unwrap_or_default();
    let name: String = format!("{scope}-{terminal}")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    std::env::temp_dir().join("agent-status").join(name)
}

/// Agents send some numbers as strings.
fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn round(x: f64, digits: i32) -> f64 {
    let f = 10f64.powi(digits);
    (x * f).round() / f
}

/// `{ pct, used, size }`; pct from used/size when not given.
fn context(pct: Option<f64>, used: Option<f64>, size: Option<f64>) -> Option<Value> {
    let pct = pct.or(match (used, size) {
        (Some(u), Some(z)) if z > 0.0 => Some(u / z * 100.0),
        _ => None,
    })?;
    let mut out = Map::new();
    out.insert("pct".into(), round(pct, 1).into());
    if let Some(used) = used {
        out.insert("used".into(), (used as u64).into());
    }
    if let Some(size) = size {
        out.insert("size".into(), (size as u64).into());
    }
    Some(Value::Object(out))
}

/// One plan limit: `{ pct, reset }` (reset in epoch seconds).
fn limit(pct: f64, reset: Option<f64>) -> Value {
    let mut out = Map::new();
    out.insert("pct".into(), round(pct, 1).into());
    if let Some(reset) = reset {
        out.insert("reset".into(), (reset as i64).into());
    }
    Value::Object(out)
}
