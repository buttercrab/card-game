//! A suite run twice gives the same numbers, whatever the thread count:
//! every deal is played on its own seeds.

use eval::results::{Results, TableResult};
use eval::run::{Request, run};
use eval::suite::{Loaded, Part};
use mighty::Mighty;

/// A small suite with cheap bots, written to a scratch folder.
fn suite() -> Loaded {
    let dir = std::env::temp_dir().join(format!("eval-reproduce-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let suite = r#"{
        "suite": "tiny",
        "game": "mighty",
        "about": "A test suite.",
        "ladder": {
            "rules": "gshs", "seed": 100, "deals": 30, "quick_deals": 5,
            "rungs": [{ "name": "random", "field": "random" }, { "name": "보통", "field": "normal" }]
        },
        "presets": { "field": "easy", "seed": 200, "deals": 10, "quick_deals": 2, "presets": ["default", "skku"] },
        "matches": [{ "name": "one", "rules": "kmla", "field": "simple", "seed": 7, "deals": 10, "quick_deals": 1 }],
        "cost": { "rules": "gshs", "field": "normal", "seed": 0, "deals": 2, "quick_deals": 1 }
    }"#;
    std::fs::write(dir.join("suite.json"), suite).unwrap();
    Loaded::load(dir.to_str().unwrap()).unwrap()
}

fn play(suite: &Loaded, threads: usize, quick: bool) -> Results {
    let request = Request {
        suite,
        bot: "normal",
        baseline: Some("easy"),
        quick,
        parts: &Part::ALL,
        threads: Some(threads),
        machine: None,
        commit: None,
        command: Vec::new(),
    };
    run::<Mighty>(&request, &mut |_| {}).unwrap()
}

#[test]
fn two_runs_agree_exactly() {
    let suite = suite();
    let (a, b) = (play(&suite, 1, false), play(&suite, 4, false));
    assert!(a.reproducible);
    let tables = |r: &Results| -> Vec<TableResult> {
        let ladder = r.ladder.as_ref().unwrap().rungs.iter();
        let presets = r.presets.as_ref().unwrap().tables.iter();
        ladder
            .chain(presets)
            .chain(r.matches.iter().flatten())
            .cloned()
            .collect()
    };
    assert_eq!(tables(&a), tables(&b));
    let cost = |r: &Results| r.cost.as_ref().unwrap().bot.unwrap().decisions;
    assert_eq!(cost(&a), cost(&b));
    assert_eq!(a.ladder.unwrap().rating, b.ladder.unwrap().rating);
}

#[test]
fn a_quick_run_plays_the_first_deals_of_each_table() {
    let suite = suite();
    let quick = play(&suite, 2, true);
    assert!(quick.suite.quick);
    let rungs = &quick.ladder.as_ref().unwrap().rungs;
    assert_eq!(rungs.iter().map(|t| t.deals).collect::<Vec<_>>(), [5, 5]);
    // Rung k starts at seed + k·deals in the full count, quick or not.
    assert_eq!(rungs[1].seed, 130);
    let paired = rungs[0].diff.expect("a baseline was given");
    assert_eq!(paired.n, 5);
}
