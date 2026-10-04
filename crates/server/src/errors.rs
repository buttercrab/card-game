//! Errors the web client hits, sent to `POST /api/errors`. Each is grouped
//! by its message and the top frame of its stack and counted in the stats.
//! A group seen for the first time (or the first time in a day) is also
//! saved under `<data>/errors`, where the deploy host picks it up and files
//! a GitHub issue labelled `error`, as it does for problem reports.

use crate::limit::{ClientIp, too_many};
use crate::stats::{Event, hex, now};
use crate::{AppState, prune_reports};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use rand::Rng;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

/// The most kept of any one field, in bytes.
const FIELD_CAP: usize = 4096;

/// A group seen again after this long counts as new.
const QUIET: u64 = 86_400;

/// New groups filed as issues at most this often, so a flood of made-up
/// errors cannot flood the issue tracker.
const ISSUES_PER_HOUR: usize = 5;

#[derive(Deserialize)]
pub struct ClientError {
    message: String,
    #[serde(default)]
    stack: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    ua: Option<String>,
    #[serde(default)]
    version: Option<String>,
}

/// At most `FIELD_CAP` bytes of `s`, cut at a character boundary.
fn cap(s: &str) -> String {
    let mut end = s.len().min(FIELD_CAP);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// The message with what varies between occurrences (numbers, ids,
/// whitespace) taken out, so one bug makes one group.
pub fn normalize(message: &str) -> String {
    let mut out = String::new();
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut String| {
        // Long hex runs are ids or hashes.
        let id = word.len() >= 8 && word.chars().all(|c| c.is_ascii_hexdigit());
        out.push_str(if id { "#" } else { word });
        word.clear();
    };
    for c in message.trim().chars() {
        if c.is_alphanumeric() || c == '_' {
            word.push(c);
            continue;
        }
        flush(&mut word, &mut out);
        if c.is_whitespace() {
            if !out.ends_with(' ') {
                out.push(' ');
            }
        } else {
            out.push(c);
        }
    }
    flush(&mut word, &mut out);
    // Numbers vary; their place in the message does not.
    let mut collapsed = String::new();
    let mut in_number = false;
    for c in out.chars() {
        if c.is_ascii_digit() {
            if !in_number {
                collapsed.push('#');
            }
            in_number = true;
        } else {
            in_number = false;
            collapsed.push(c);
        }
    }
    collapsed.chars().take(300).collect()
}

/// The top frame of a stack as `function@file`, without the line, column,
/// origin or the build hash in the file name, which change with every deploy.
pub fn top_frame(stack: &str) -> String {
    for line in stack.lines().map(str::trim) {
        // Chrome: "at fn (https://host/assets/index-abc.js:1:2)"; Firefox and
        // Safari: "fn@https://host/assets/index-abc.js:1:2".
        let (function, location) = if let Some(rest) = line.strip_prefix("at ") {
            match rest.rsplit_once(" (") {
                Some((f, loc)) => (f, loc.trim_end_matches(')')),
                None => ("", rest),
            }
        } else if let Some((f, loc)) = line.rsplit_once('@') {
            (f, loc)
        } else {
            continue;
        };
        if !location.contains(':') {
            continue;
        }
        let path = location.split(['?', '#']).next().unwrap_or("");
        let path = path.trim_end_matches(|c: char| c.is_ascii_digit() || c == ':');
        let file = path.rsplit('/').next().unwrap_or(path);
        let file = strip_build_hash(file);
        return format!("{function}@{file}").chars().take(200).collect();
    }
    String::new()
}

/// `index-B9xk2_aQ.js` → `index.js`. Vite's hashes are eight URL-safe
/// characters, which may include `-`.
fn strip_build_hash(file: &str) -> String {
    let Some((stem, ext)) = file.rsplit_once('.') else {
        return file.to_string();
    };
    let hashlike = |h: &str| h.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if let Some(cut) = stem.len().checked_sub(9)
        && cut > 0
        && stem.as_bytes()[cut] == b'-'
        && hashlike(&stem[cut + 1..])
    {
        return format!("{}.{ext}", &stem[..cut]);
    }
    match stem.rsplit_once('-') {
        Some((base, hash)) if hash.len() >= 6 && hashlike(hash) => format!("{base}.{ext}"),
        _ => file.to_string(),
    }
}

/// A short id for the group of `message` at `frame`.
pub fn group(message: &str, frame: &str) -> String {
    let digest = Sha256::new()
        .chain_update(message.as_bytes())
        .chain_update(b"\n")
        .chain_update(frame.as_bytes())
        .finalize();
    hex(&digest[..6])
}

pub async fn client_error(State(app): State<AppState>, ClientIp(ip): ClientIp, Json(e): Json<ClientError>) -> Response {
    if !app.limits.errors.allow(ip) {
        return too_many();
    }
    let message = cap(e.message.trim());
    if message.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let stack = e.stack.as_deref().map(cap);
    let normalized = normalize(&message);
    let frame = stack.as_deref().map(top_frame).unwrap_or_default();
    let group = group(&normalized, &frame);
    let version = e.version.as_deref().map(|v| v.chars().take(40).collect::<String>());
    let t = now();
    let new = app
        .stats
        .error_last_seen(&group)
        .is_none_or(|seen| t.saturating_sub(seen) >= QUIET);
    app.stats.record_at(
        t,
        Event::ClientError {
            group: group.clone(),
            message: normalized.clone(),
            frame: frame.clone(),
            version: version.clone(),
        },
    );
    if !new {
        return StatusCode::NO_CONTENT.into_response();
    }
    {
        let mut filed = app.error_issues.lock().expect("error issue times poisoned");
        filed.retain(|t| t.elapsed() < Duration::from_secs(3600));
        if filed.len() >= ISSUES_PER_HOUR {
            tracing::warn!(group, "new client error, not filed: too many this hour");
            return StatusCode::NO_CONTENT.into_response();
        }
        filed.push(Instant::now());
    }
    let error = json!({
        "time": t,
        "server_version": env!("CARGO_PKG_VERSION"),
        "group": group,
        "message": message,
        "normalized": normalized,
        "frame": frame,
        "stack": stack,
        "url": e.url.as_deref().map(cap),
        "ua": e.ua.as_deref().map(cap),
        "version": version,
    });
    tracing::warn!(error = %error, "new client error");
    if let Some(dir) = &app.data {
        let dir = dir.join("errors");
        let name = format!("{t}-{group}-{:04x}.json", rand::rng().random::<u16>());
        let saved = std::fs::create_dir_all(&dir).and_then(|()| std::fs::write(dir.join(name), error.to_string()));
        if let Err(e) = saved {
            tracing::error!("could not save the client error: {e}");
        }
        prune_reports(&dir, t);
    }
    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_lose_what_varies() {
        assert_eq!(
            normalize("Cannot read properties of undefined (reading 'seat')"),
            "Cannot read properties of undefined (reading 'seat')"
        );
        assert_eq!(normalize("  bad   seat 3 of 5\n"), "bad seat # of #");
        assert_eq!(normalize("room a1b2c3d4e5 closed"), "room # closed");
        assert_eq!(normalize("took 1234.5ms"), "took #.#ms");
        assert_eq!(normalize("뭔가 잘못됐어요 42"), "뭔가 잘못됐어요 #");
        assert_eq!(normalize(&"x".repeat(1000)).len(), 300);
    }

    #[test]
    fn the_top_frame_ignores_lines_columns_and_build_hashes() {
        let chrome = "TypeError: x is undefined\n    at Kt (https://cards.buttercrab.io/assets/index-B9xk2_aQ.js:1:23456)\n    at https://cards.buttercrab.io/assets/index-B9xk2_aQ.js:2:1";
        assert_eq!(top_frame(chrome), "Kt@index.js");
        let firefox =
            "Kt@https://cards.buttercrab.io/assets/index-Zz81LmQp.js:1:999\n@https://cards.buttercrab.io/x.js:1:1";
        assert_eq!(top_frame(firefox), "Kt@index.js");
        assert_eq!(
            top_frame("    at https://h/assets/vendor-abcdef12.js?v=1:3:4"),
            "@vendor.js"
        );
        assert_eq!(top_frame("at f (https://h/assets/Room-B9x-k2aQ.js:1:2)"), "f@Room.js");
        assert_eq!(top_frame("at f (https://h/music.svelte.ts:1:2)"), "f@music.svelte.ts");
        assert_eq!(top_frame("no frames here"), "");
        assert_eq!(top_frame(""), "");
    }

    #[test]
    fn the_same_bug_after_a_deploy_is_the_same_group() {
        let before = top_frame("at f (https://h/assets/index-AAAAAAAA.js:1:100)");
        let after = top_frame("at f (https://h/assets/index-BBBBBBBB.js:1:180)");
        let a = group(&normalize("seat 3 is gone"), &before);
        let b = group(&normalize("seat 4 is gone"), &after);
        assert_eq!(a, b);
        assert_ne!(a, group(&normalize("seat 3 is here"), &before));
        assert_ne!(a, group(&normalize("seat 3 is gone"), "g@index.js"));
        assert_eq!(a.len(), 12);
    }

    #[test]
    fn fields_are_capped_at_a_character_boundary() {
        let long = "가".repeat(3000);
        let capped = cap(&long);
        assert!(capped.len() <= FIELD_CAP);
        assert!(capped.chars().all(|c| c == '가'));
        assert_eq!(cap("short"), "short");
    }
}
