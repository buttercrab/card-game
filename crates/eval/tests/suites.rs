//! The suites in research/evals load, name only bots and rules that
//! exist, and match the files they hash. Also how v1's held-out rule sets
//! were drawn (ignored: they are drawn once, then fixed).

use eval::suite::{Loaded, sha256};
use eval::{Research, preset};
use mighty::Mighty;
use mighty::rules::{Preset, Rules};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

const EVALS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../research/evals");

/// v1's held-out rule sets: how many, and the seed of the first draw.
const HELDOUT_SETS: usize = 40;
const HELDOUT_SEED: u64 = 20_261_004;

fn load(name: &str) -> Loaded {
    Loaded::load(&format!("{EVALS}/{name}")).unwrap_or_else(|e| panic!("{e}"))
}

/// Every bot, rule set and file the suite names exists.
fn check(loaded: &Loaded) {
    let s = &loaded.suite;
    assert_eq!(s.game, "mighty");
    let bot = |name: &str| Mighty::parse_bot(name).unwrap_or_else(|e| panic!("{e}"));
    let rules = |id: &str| preset::<Mighty>(id).unwrap_or_else(|e| panic!("{e}"));
    if let Some(ladder) = &s.ladder {
        rules(&ladder.rules);
        ladder.rungs.iter().for_each(|r| _ = bot(&r.field));
    }
    if let Some(p) = &s.presets {
        bot(&p.field);
        p.presets.iter().for_each(|id| _ = rules(id));
    }
    if let Some(h) = &s.heldout {
        bot(&h.field);
        let sets: Vec<Rules> = serde_json::from_slice(&loaded.read(&h.file, &h.sha256).unwrap()).unwrap();
        assert!(h.quick_sets <= sets.len());
    }
    for m in s.matches.iter().flatten() {
        bot(&m.field);
        eval::rules::<Mighty>(&m.rules).unwrap_or_else(|e| panic!("{e}"));
    }
    if let Some(c) = &s.cost {
        bot(&c.field);
        rules(&c.rules);
    }
    if let Some(p) = &s.puzzles {
        loaded.read(&p.file, &p.sha256).unwrap();
    }
}

#[test]
fn v1_is_whole() {
    let v1 = load("v1");
    check(&v1);
    let s = &v1.suite;
    assert_eq!(s.suite, "v1");
    let rungs: Vec<&str> = s
        .ladder
        .as_ref()
        .unwrap()
        .rungs
        .iter()
        .map(|r| r.field.as_str())
        .collect();
    assert_eq!(rungs, ["random", "easy", "normal", "hard"]);
    let presets = &s.presets.as_ref().unwrap().presets;
    assert_eq!(*presets, Preset::ALL.map(|p| p.name().to_string()));
}

#[test]
fn the_benchmark_suite_is_whole() {
    let bench = load("bench-2026-10-04");
    check(&bench);
    // The benchmark's `default` was web-mighty's base, before 기본 became
    // the owner's rules; the suite gives it in full.
    for m in bench
        .suite
        .matches
        .iter()
        .flatten()
        .filter(|m| m.name.starts_with("web-mighty"))
    {
        let (_, rules) = eval::rules::<Mighty>(&m.rules).unwrap();
        assert_eq!(rules, Rules::web_mighty(), "{}", m.name);
    }
}

/// The held-out sets: valid, distinct, none a preset, and exactly
/// `HELDOUT_SETS` of them. The RL environment reads this file to keep
/// them out of training.
#[test]
fn heldout_rule_sets_are_valid_and_new() {
    let v1 = load("v1");
    let h = v1.suite.heldout.as_ref().unwrap();
    let sets: Vec<Rules> = serde_json::from_slice(&v1.read(&h.file, &h.sha256).unwrap()).unwrap();
    assert_eq!(sets.len(), HELDOUT_SETS);
    for (i, rules) in sets.iter().enumerate() {
        rules.validate().unwrap_or_else(|e| panic!("set {i}: {e}"));
        assert!(!sets[..i].contains(rules), "set {i} repeats an earlier one");
        assert!(Preset::ALL.iter().all(|p| p.rules() != *rules), "set {i} is a preset");
    }
}

/// The sets cycle through the presets as bases, each drawn with
/// [`Rules::varied`] from its own seed, skipping draws that repeat one.
fn draw_heldout() -> Vec<Rules> {
    let mut sets: Vec<Rules> = Vec::new();
    let mut seed = HELDOUT_SEED;
    while sets.len() < HELDOUT_SETS {
        let base = Preset::ALL[sets.len() % Preset::ALL.len()].rules();
        let rules = base.varied(&mut ChaCha8Rng::seed_from_u64(seed));
        seed += 1;
        if !sets.contains(&rules) && Preset::ALL.iter().all(|p| p.rules() != rules) {
            sets.push(rules);
        }
    }
    sets
}

/// Writes the held-out sets and prints their hash for the suite file:
/// `cargo test -p eval --test suites -- --ignored write_heldout_rules`.
/// Only for a new suite version; v1's file is fixed.
#[test]
#[ignore = "writes research/evals/v1/heldout-rules.json"]
fn write_heldout_rules() {
    let json = serde_json::to_string_pretty(&draw_heldout()).unwrap() + "\n";
    std::fs::write(format!("{EVALS}/v1/heldout-rules.json"), &json).unwrap();
    println!("sha256 {}", sha256(json.as_bytes()));
}
