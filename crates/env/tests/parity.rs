//! Recorded positions for the Rust–Python parity test.
//!
//! `parity.json` pins what the environment returns, field by field, for a
//! fixed run: a pool of rule sets frozen in `parity-rules.json` (copied
//! once from the presets and varied draws of them, so changing a preset
//! moves nothing here), every seat played by a choice anyone can repeat
//! ([`common::choose`]). `ml/tests/test_env.py` replays the same run
//! through the Python bindings and must get the same bytes. The fixture
//! changes only with the encoding (bump its version) or the environment's
//! seeding; rewrite it with `scripts/regenerate-fixtures.sh` (or
//! `cargo test -p env --test parity -- --ignored write_parity_fixture`).

mod common;

use common::{choose, env, setup};
use env::Batch;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const SEED: u64 = 7;
/// The rule sets the run draws from, as the Python side reads them too.
const RULES: &str = include_str!("parity-rules.json");
const NUM_ENVS: usize = 3;
const STEPS: usize = 120;

/// The first 16 hex digits of the SHA-256 of `bytes`.
fn hash(bytes: impl IntoIterator<Item = u8>) -> String {
    let bytes: Vec<u8> = bytes.into_iter().collect();
    Sha256::digest(&bytes)
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn le<T: Copy, const N: usize>(values: &[T], bytes: fn(T) -> [u8; N]) -> String {
    hash(values.iter().flat_map(|&v| bytes(v)))
}

/// Each field's hash, over its little-endian bytes (booleans one byte).
fn hashes(batch: &Batch, belief: &[i32]) -> Value {
    json!({
        "global": le(&batch.global, f32::to_le_bytes),
        "cards": le(&batch.cards, f32::to_le_bytes),
        "events": le(&batch.events, f32::to_le_bytes),
        "event_cards": le(&batch.event_cards, i32::to_le_bytes),
        "events_len": le(&batch.events_len, i32::to_le_bytes),
        "legal": hash(batch.legal.iter().map(|&b| u8::from(b))),
        "seat": le(&batch.seat, i32::to_le_bytes),
        "reward": le(&batch.reward, f32::to_le_bytes),
        "done": hash(batch.done.iter().map(|&b| u8::from(b))),
        "belief": le(belief, i32::to_le_bytes),
    })
}

fn record() -> Value {
    let mut env = env(setup(RULES, &[0, 1, 2, 3, 4, 5, 6, 7], &[]), NUM_ENVS, SEED, 0);
    let actions = env.spec().actions.len();
    let mut batch = env.reset(None).unwrap();
    let mut steps = vec![json!({"actions": null, "hashes": hashes(&batch, &env.belief_targets().unwrap())})];
    for step in 0..STEPS {
        let chosen = choose(&batch, actions, step);
        batch = env.step(&chosen).unwrap();
        steps.push(json!({"actions": chosen, "hashes": hashes(&batch, &env.belief_targets().unwrap())}));
    }
    json!({
        "game": "mighty",
        "encoding": env.spec().version,
        "rules": "crates/env/tests/parity-rules.json",
        "seed": SEED,
        "num_envs": NUM_ENVS,
        "steps": steps,
    })
}

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/parity.json");

#[test]
fn parity_fixture_is_current() {
    let pinned: Value = serde_json::from_str(&std::fs::read_to_string(FIXTURE).unwrap()).unwrap();
    assert!(
        record() == pinned,
        "the environment's output changed; if on purpose, rewrite tests/parity.json"
    );
}

#[test]
#[ignore]
fn write_parity_fixture() {
    std::fs::write(FIXTURE, serde_json::to_string_pretty(&record()).unwrap() + "\n").unwrap();
}
