//! `eval check-bot --json`, which the research loop asks whether a bot's
//! runs reproduce instead of matching its name itself.

use serde_json::{Value, json};
use std::process::Command;

fn check_bot(spec: &str) -> (bool, Value) {
    let out = Command::new(env!("CARGO_BIN_EXE_eval"))
        .args(["check-bot", "--json", "--", spec])
        .output()
        .expect("eval runs");
    let line = String::from_utf8(out.stdout).expect("utf-8");
    let json = serde_json::from_str(line.trim()).unwrap_or_else(|e| panic!("{spec}: {e}: {line:?}"));
    (out.status.success(), json)
}

#[test]
fn check_bot_says_the_kind_and_whether_runs_reproduce() {
    for (spec, kind, reproducible) in [
        ("hard", "search", true),
        ("search:400:1:0", "search", true),
        ("search", "search", false),
        ("search:400", "search", false),
        ("search:200:1:150", "search", false),
        ("normal", "simple", true),
        ("dmc:{artifacts}/models/dmc-v1", "dmc", true),
        ("hybrid:{artifacts}/models/dmc-v1:40@threads=2", "hybrid", true),
        ("belief:{artifacts}/models/belief-v1:50", "belief", true),
    ] {
        let (ok, out) = check_bot(spec);
        assert!(ok, "{spec}: {out}");
        assert_eq!(out["spec"], json!(spec));
        assert_eq!(
            (out["kind"].clone(), out["reproducible"].clone()),
            (json!(kind), json!(reproducible)),
            "{spec}"
        );
        assert!(out["reason"].as_str().is_some_and(|r| !r.is_empty()), "{spec}: {out}");
    }
}

#[test]
fn check_bot_reports_a_bad_spec_and_fails() {
    for spec in ["random@bid_base=7", "search:20:1:0:junk", "--out=/", "expert"] {
        let (ok, out) = check_bot(spec);
        assert!(!ok, "{spec}");
        assert!(out["error"].as_str().is_some_and(|e| !e.is_empty()), "{spec}: {out}");
        assert!(out.get("reproducible").is_none());
    }
}
