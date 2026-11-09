//! Claude Code: run as its `statusLine` command, with the session's status JSON
//! on stdin. In herdr the status goes to the label and nothing is printed, so
//! Claude Code's own status line stays empty. Elsewhere the JSON goes to
//! ccstatusline when that is installed (one statusLine command serves both),
//! else one plain line is printed.

use crate::{context, limit, num, publish, round};
use serde_json::{Map, Value};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

pub fn run(input: &str, status: &Value, terminal: Option<&str>) {
    let mut summary = summarize(status);
    if !summary.contains_key("effort") {
        if let Some(level) = settings_effort() {
            summary.insert("effort".into(), level.into());
        }
    }
    match terminal {
        Some(terminal) => publish(terminal, &summary),
        None => {
            if !ccstatusline(input) {
                println!("{}", one_line(&summary));
            }
        }
    }
}

pub fn summarize(s: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    out.insert("agent".into(), "claude".into());
    let model = s.pointer("/model/display_name").or_else(|| s.get("model")).and_then(Value::as_str);
    if let Some(model) = model {
        out.insert("model".into(), model.into());
    }
    if let Some(level) = s.pointer("/effort/level").and_then(Value::as_str) {
        out.insert("effort".into(), level.into());
    }
    if let Some(cw) = s.get("context_window").filter(|c| c.is_object()) {
        let used = match cw.get("current_usage") {
            Some(Value::Object(u)) => Some(
                ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
                    .iter()
                    .filter_map(|k| u.get(*k).and_then(num))
                    .sum::<f64>(),
            ),
            Some(v) => num(v),
            None => None,
        };
        let pct = cw.get("used_percentage").and_then(num);
        if let Some(ctx) = context(pct, used, cw.get("context_window_size").and_then(num)) {
            out.insert("ctx".into(), ctx);
        }
    }
    if let Some(cost) = s.pointer("/cost/total_cost_usd").and_then(num) {
        out.insert("cost".into(), round(cost, 2).into());
    }
    if let Some(rl) = s.get("rate_limits").and_then(Value::as_object) {
        let mut limits = Map::new();
        for (key, name) in [("five_hour", "5h"), ("seven_day", "7d"), ("seven_day_opus", "7d Opus"), ("seven_day_sonnet", "7d Sonnet")] {
            let Some(bucket) = rl.get(key).and_then(Value::as_object) else { continue };
            let Some(pct) = bucket.get("used_percentage").and_then(num) else { continue };
            limits.insert(name.into(), limit(pct, bucket.get("resets_at").and_then(num)));
        }
        if !limits.is_empty() {
            out.insert("limits".into(), Value::Object(limits));
        }
    }
    let cwd = s.pointer("/workspace/current_dir").or_else(|| s.get("cwd"));
    if let Some(cwd) = cwd.and_then(Value::as_str) {
        out.insert("cwd".into(), cwd.into());
    }
    if let Some(worktree) = s.get("worktree").and_then(Value::as_object) {
        let w: Map<String, Value> = ["name", "branch"]
            .iter()
            .filter_map(|k| Some((k.to_string(), worktree.get(*k)?.as_str()?.into())))
            .collect();
        if !w.is_empty() {
            out.insert("worktree".into(), Value::Object(w));
        }
    }
    out
}

/// Older Claude Code versions don't send the effort level; the setting is the fallback.
fn settings_effort() -> Option<String> {
    let dir = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(|h| PathBuf::from(h).join(".claude"))
    })?;
    let text = std::fs::read_to_string(dir.join("settings.json")).ok()?;
    let settings: Value = serde_json::from_str(&text).ok()?;
    settings.get("effortLevel")?.as_str().map(str::to_owned)
}

/// ccstatusline draws the line when it's installed; its output is passed through.
/// False when it isn't there or fails.
fn ccstatusline(input: &str) -> bool {
    // npm installs a .cmd shim on Windows, which Command doesn't find by bare name.
    let programs: &[&str] = if cfg!(windows) { &["ccstatusline.cmd", "ccstatusline"] } else { &["ccstatusline"] };
    for program in programs {
        let Ok(mut child) = Command::new(program)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            continue;
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input.as_bytes());
        }
        return match child.wait_with_output() {
            Ok(out) if out.status.success() && !out.stdout.is_empty() => std::io::stdout().write_all(&out.stdout).is_ok(),
            _ => false,
        };
    }
    false
}

/// "Opus 5.5 · xhigh | ctx 21% (213k/1.0M) | $4.85 | 5h 12% · 7d 31%".
fn one_line(s: &Map<String, Value>) -> String {
    let mut parts = Vec::new();
    let head: Vec<&str> = ["model", "effort"].iter().filter_map(|k| s.get(*k)?.as_str()).collect();
    if !head.is_empty() {
        parts.push(head.join(" · "));
    }
    if let Some(ctx) = s.get("ctx") {
        let pct = ctx.get("pct").and_then(Value::as_f64).unwrap_or(0.0);
        let mut text = format!("ctx {pct:.0}%");
        if let (Some(used), Some(size)) = (ctx.get("used").and_then(Value::as_f64), ctx.get("size").and_then(Value::as_f64)) {
            text += &format!(" ({}/{})", tokens(used), tokens(size));
        }
        parts.push(text);
    }
    if let Some(cost) = s.get("cost").and_then(Value::as_f64) {
        parts.push(format!("${cost:.2}"));
    }
    if let Some(limits) = s.get("limits").and_then(Value::as_object) {
        let text: Vec<String> = limits
            .iter()
            .filter_map(|(name, l)| Some(format!("{name} {:.0}%", l.get("pct")?.as_f64()?)))
            .collect();
        parts.push(text.join(" · "));
    }
    parts.join(" | ")
}

fn tokens(n: f64) -> String {
    if n >= 1e6 {
        format!("{:.1}M", n / 1e6)
    } else if n >= 1e3 {
        format!("{:.0}k", n / 1e3)
    } else {
        format!("{n:.0}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Value {
        json!({
            "model": { "id": "claude-opus-5-5", "display_name": "Opus 5.5" },
            "effort": { "level": "xhigh" },
            "workspace": { "current_dir": "C:\\Users\\Justin\\tonglin" },
            "cost": { "total_cost_usd": 4.8512 },
            "context_window": {
                "context_window_size": 1000000,
                "current_usage": { "input_tokens": 10, "cache_creation_input_tokens": "3000", "cache_read_input_tokens": 210000 },
                "used_percentage": 21.301
            },
            "rate_limits": {
                "five_hour": { "used_percentage": 12, "resets_at": 1762700000 },
                "seven_day": { "used_percentage": "31.04", "resets_at": 1763000000 },
                "seven_day_opus": null
            },
            "worktree": { "name": "fix-login", "branch": "fix/login", "path": "/x" }
        })
    }

    #[test]
    fn summarizes_the_fields_the_mods_show() {
        let s = Value::Object(summarize(&sample()));
        assert_eq!(s["agent"], "claude");
        assert_eq!(s["model"], "Opus 5.5");
        assert_eq!(s["effort"], "xhigh");
        assert_eq!(s["cost"], 4.85);
        assert_eq!(s["ctx"], json!({ "pct": 21.3, "used": 213010, "size": 1000000 }));
        assert_eq!(s["limits"], json!({ "5h": { "pct": 12.0, "reset": 1762700000 }, "7d": { "pct": 31.0, "reset": 1763000000 } }));
        assert_eq!(s["cwd"], "C:\\Users\\Justin\\tonglin");
        assert_eq!(s["worktree"], json!({ "name": "fix-login", "branch": "fix/login" }));
    }

    #[test]
    fn computes_context_percent_when_not_sent() {
        let s = summarize(&json!({ "context_window": { "context_window_size": 200000, "current_usage": { "input_tokens": 50000 } } }));
        assert_eq!(s["ctx"], json!({ "pct": 25.0, "used": 50000, "size": 200000 }));
    }

    #[test]
    fn leaves_out_what_is_missing() {
        let s = summarize(&json!({ "model": "sonnet", "rate_limits": null, "context_window": null }));
        assert_eq!(Value::Object(s), json!({ "agent": "claude", "model": "sonnet" }));
    }

    #[test]
    fn one_line_outside_herdr() {
        assert_eq!(one_line(&summarize(&sample())), "Opus 5.5 · xhigh | ctx 21% (213k/1.0M) | $4.85 | 5h 12% · 7d 31%");
    }
}
