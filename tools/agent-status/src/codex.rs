//! Codex: run as a hook (SessionStart, PostToolUse, Stop). The hook JSON names the
//! session's rollout file (`transcript_path`); its latest `turn_context` has the
//! model, effort and folder, its latest `token_count` the context and plan limits.
//! Codex draws its own status line, so outside herdr this does nothing, and it
//! never prints: hook output can steer Codex.

use crate::{context, limit, num, publish};
use serde_json::{Map, Value};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub fn run(hook: &Value, terminal: Option<&str>) {
    let Some(terminal) = terminal else { return };
    let Some(path) = hook.get("transcript_path").and_then(Value::as_str) else { return };
    let (turn, tokens) = latest(Path::new(path));
    let mut summary = summarize(turn.as_ref(), tokens.as_ref());
    if !summary.contains_key("cwd") {
        if let Some(cwd) = hook.get("cwd").and_then(Value::as_str) {
            summary.insert("cwd".into(), cwd.into());
        }
    }
    publish(terminal, &summary);
}

pub fn summarize(turn: Option<&Value>, tokens: Option<&Value>) -> Map<String, Value> {
    let mut out = Map::new();
    out.insert("agent".into(), "codex".into());
    if let Some(turn) = turn {
        for key in ["model", "effort", "cwd"] {
            if let Some(v) = turn.get(key).and_then(Value::as_str) {
                out.insert(key.into(), v.into());
            }
        }
    }
    let Some(tokens) = tokens else { return out };
    // What the last request sent fills the window now.
    let used = tokens.pointer("/info/last_token_usage/total_tokens").and_then(num);
    let size = tokens.pointer("/info/model_context_window").and_then(num);
    if let (Some(ctx), Some(_)) = (context(None, used, size), used) {
        out.insert("ctx".into(), ctx);
    }
    if let Some(rl) = tokens.get("rate_limits").and_then(Value::as_object) {
        let mut limits = Map::new();
        for key in ["primary", "secondary"] {
            let Some(bucket) = rl.get(key).and_then(Value::as_object) else { continue };
            let (Some(pct), Some(minutes)) = (bucket.get("used_percent").and_then(num), bucket.get("window_minutes").and_then(num)) else {
                continue;
            };
            limits.insert(window(minutes as u64), limit(pct, bucket.get("resets_at").and_then(num)));
        }
        if !limits.is_empty() {
            out.insert("limits".into(), Value::Object(limits));
        }
    }
    out
}

/// 300 -> "5h", 10080 -> "7d".
fn window(minutes: u64) -> String {
    if minutes >= 1440 && minutes % 1440 == 0 {
        format!("{}d", minutes / 1440)
    } else if minutes >= 60 && minutes % 60 == 0 {
        format!("{}h", minutes / 60)
    } else {
        format!("{minutes}m")
    }
}

/// The latest turn_context and token_count payloads, read from the end of the
/// rollout: a long session's file runs to megabytes, and a hook runs every tool call.
fn latest(path: &Path) -> (Option<Value>, Option<Value>) {
    let Ok(mut file) = File::open(path) else { return (None, None) };
    let Ok(len) = file.metadata().map(|m| m.len()) else { return (None, None) };
    let mut chunk: u64 = 256 * 1024;
    loop {
        let start = len.saturating_sub(chunk);
        let mut buf = Vec::new();
        if file.seek(SeekFrom::Start(start)).is_err() || file.read_to_end(&mut buf).is_err() {
            return (None, None);
        }
        let text = String::from_utf8_lossy(&buf);
        // A chunk that starts mid-file starts mid-line.
        let skip = usize::from(start > 0);
        let (mut turn, mut tokens) = (None, None);
        for line in text.lines().skip(skip).collect::<Vec<_>>().into_iter().rev() {
            if turn.is_none() && line.contains("\"turn_context\"") {
                turn = parse(line).filter(|v| v["type"] == "turn_context").map(|v| v["payload"].clone());
            }
            if tokens.is_none() && line.contains("\"token_count\"") {
                tokens = parse(line).filter(|v| v["payload"]["type"] == "token_count").map(|v| v["payload"].clone());
            }
            if turn.is_some() && tokens.is_some() {
                break;
            }
        }
        if (turn.is_some() && tokens.is_some()) || start == 0 {
            return (turn, tokens);
        }
        chunk *= 4;
    }
}

fn parse(line: &str) -> Option<Value> {
    serde_json::from_str(line).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rollout() -> String {
        [
            json!({ "type": "session_meta", "payload": { "id": "x" } }),
            json!({ "type": "turn_context", "payload": { "model": "gpt-old", "effort": "low", "cwd": "C:\\old" } }),
            json!({ "type": "event_msg", "payload": { "type": "token_count", "info": null, "rate_limits": { "primary": { "used_percent": 1.0, "window_minutes": 300, "resets_at": 100 } } } }),
            json!({ "type": "turn_context", "payload": { "model": "gpt-6-sol", "effort": "xhigh", "cwd": "C:\\Users\\Justin\\tonglin" } }),
            json!({ "type": "event_msg", "payload": { "type": "token_count",
                "info": { "last_token_usage": { "total_tokens": 151636 }, "model_context_window": 258400 },
                "rate_limits": {
                    "primary": { "used_percent": 2.0, "window_minutes": 300, "resets_at": 1790176180 },
                    "secondary": { "used_percent": "7.5", "window_minutes": 10080, "resets_at": 1790491770 },
                    "credits": { "has_credits": false } } } }),
            // Mentions both words, as text: not a record of either kind.
            json!({ "type": "response_item", "payload": { "type": "message", "content": ["token_count", "turn_context"] } }),
            json!({ "type": "event_msg", "payload": { "type": "task_complete" } }),
        ]
        .iter()
        .map(|v| v.to_string() + "\n")
        .collect()
    }

    #[test]
    fn reads_the_latest_turn_and_tokens() {
        let path = std::env::temp_dir().join(format!("agent-status-test-{}.jsonl", std::process::id()));
        std::fs::write(&path, rollout()).unwrap();
        let (turn, tokens) = latest(&path);
        std::fs::remove_file(&path).unwrap();
        let s = Value::Object(summarize(turn.as_ref(), tokens.as_ref()));
        assert_eq!(
            s,
            json!({
                "agent": "codex",
                "model": "gpt-6-sol",
                "effort": "xhigh",
                "cwd": "C:\\Users\\Justin\\tonglin",
                "ctx": { "pct": 58.7, "used": 151636, "size": 258400 },
                "limits": { "5h": { "pct": 2.0, "reset": 1790176180 }, "7d": { "pct": 7.5, "reset": 1790491770 } }
            })
        );
    }

    #[test]
    fn names_windows() {
        assert_eq!(window(300), "5h");
        assert_eq!(window(10080), "7d");
        assert_eq!(window(90), "90m");
    }

    #[test]
    fn a_new_session_has_only_what_it_has() {
        let s = summarize(None, None);
        assert_eq!(Value::Object(s), json!({ "agent": "codex" }));
    }
}
