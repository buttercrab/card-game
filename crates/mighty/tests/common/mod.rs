//! Pinned games and golden files for the tests that pin Mighty's output.
//!
//! A pinned game's rules are frozen in `tests/pinned/*-games.json`, copied
//! once from the presets (and varied draws of them) of 2026-10: changing a
//! preset's house rules leaves them, and so the pins, alone. The pinned
//! output itself lives in golden files next to them, rewritten by
//! `scripts/regenerate-fixtures.sh` when it changes on purpose.

// Each test binary uses its own share of these.
#![allow(dead_code)]

use mighty::Options;
use mighty::rules::Rules;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
pub struct PinnedGame {
    /// Seeds the game's deals and, for bots, their choices.
    pub seed: u64,
    pub first_bidder: usize,
    pub rules: Rules,
}

impl PinnedGame {
    pub fn options(&self) -> Options {
        Options {
            rules: self.rules.clone(),
            first_bidder: self.first_bidder,
        }
    }
}

pub fn pinned(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/pinned")
        .join(name)
}

/// The games frozen in `tests/pinned/<name>`.
pub fn pinned_games(name: &str) -> Vec<PinnedGame> {
    let path = pinned(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// Checks `lines` against the golden file `tests/pinned/<name>`, naming the
/// first line that differs and how to rewrite the file (`writer` is the
/// ignored test that does).
pub fn check_golden(name: &str, lines: &[String], writer: &str) {
    let path = pinned(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let golden: Vec<&str> = text.lines().collect();
    let rewrite = format!(
        "if the change is meant, rewrite it with scripts/regenerate-fixtures.sh \
         (or this file alone: cargo test -p mighty --test {writer} -- --ignored write) and review the diff"
    );
    for (i, (want, got)) in golden.iter().zip(lines).enumerate() {
        assert!(
            want == got,
            "tests/pinned/{name} line {}:\n  pinned: {want}\n  now:    {got}\n{rewrite}",
            i + 1
        );
    }
    assert_eq!(
        golden.len(),
        lines.len(),
        "tests/pinned/{name} has {} lines, now {}; {rewrite}",
        golden.len(),
        lines.len()
    );
}

/// Writes the golden file `tests/pinned/<name>`.
pub fn write_golden(name: &str, lines: &[String]) {
    std::fs::write(pinned(name), lines.join("\n") + "\n").unwrap();
}
