//! Self-play datasets: whole games in shards, reproducible byte for byte,
//! never on excluded rules, with a manifest that matches the files.

use env::selfplay::{self, BotWeight, Config, Provenance};
use flate2::read::GzDecoder;
use mighty::Mighty;
use mighty::rules::{Preset, Rules};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

/// A fresh directory under the system's temporary one.
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("env-selfplay-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn config(exclude: Option<&str>) -> Config {
    let bots = [("random", 2.0), ("simple", 1.0), ("초보", 1.0)];
    Config {
        name: "test".into(),
        game: "mighty".into(),
        seed: 5,
        games: 60,
        rules: "varied".into(),
        exclude: exclude.map(PathBuf::from),
        bots: bots
            .iter()
            .map(|&(spec, weight)| BotWeight {
                spec: spec.into(),
                weight,
            })
            .collect(),
        shard_decisions: 800,
        eval_only: false,
    }
}

fn read_rules(dir: &Path) -> Vec<Rules> {
    let file = std::fs::File::open(dir.join("rules.jsonl.gz")).unwrap();
    BufReader::new(GzDecoder::new(file))
        .lines()
        .map(|line| {
            let mut value: serde_json::Value = serde_json::from_str(&line.unwrap()).unwrap();
            serde_json::from_value(value["rules"].take()).unwrap()
        })
        .collect()
}

#[test]
fn datasets_are_reproducible_and_avoid_excluded_rules() {
    let root = scratch("root");
    // Hold out rule sets a first run plays, then check a second avoids them.
    let first = selfplay::run::<Mighty>(&config(None), &root, &root.join("free"), 2, |_| {}).unwrap();
    let held_out: Vec<Rules> = read_rules(&root.join("free")).into_iter().step_by(3).collect();
    std::fs::write(root.join("heldout.json"), serde_json::to_string(&held_out).unwrap()).unwrap();

    let config = config(Some("heldout.json"));
    let a = selfplay::run::<Mighty>(&config, &root, &root.join("a"), 1, |_| {}).unwrap();
    let b = selfplay::run::<Mighty>(&config, &root, &root.join("b"), 3, |_| {}).unwrap();
    assert_eq!(a.stats, b.stats);
    assert_eq!(a.shards, b.shards);
    for file in a.files() {
        let read = |run: &str| std::fs::read(root.join(run).join(&file)).unwrap();
        assert!(read("a") == read("b"), "{file} differs between thread counts");
    }
    assert_ne!(first.stats, a.stats, "other rules, other games");

    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("a/meta.json")).unwrap()).unwrap();
    assert_eq!(meta["excluded"]["rule_sets"], held_out.len());
    assert_eq!(meta["excluded"]["sha256"].as_str().unwrap().len(), 64);

    let played = read_rules(&root.join("a"));
    assert_eq!(played.len(), a.stats.rule_sets);
    assert!(
        played.iter().all(|r| !held_out.contains(r)),
        "a held-out rule set was played"
    );

    // Whole games, about the asked size, adding up.
    assert!(a.shards.len() >= 3, "{} shards", a.shards.len());
    assert!(a.shards.iter().rev().skip(1).all(|s| s.decisions >= 800));
    assert_eq!(a.shards.iter().map(|s| s.games as u64).sum::<u64>(), 60);
    let decisions: u64 = a.stats.decisions_by_bot.values().sum();
    assert_eq!(decisions, a.stats.decisions);
    assert_eq!(a.stats.players.values().sum::<u64>(), 60);
    assert_eq!(a.stats.players.len(), 5, "3 to 7 players");

    let provenance = Provenance {
        commit: "0".repeat(40),
        config: "research/experiments/x/config.toml".into(),
        created: "2026-10-04".into(),
    };
    let manifest = selfplay::manifest(&config, &a, &root.join("a"), "selfplay/test", &provenance).unwrap();
    let artifacts = manifest["artifacts"].as_array().unwrap();
    assert_eq!(artifacts.len(), a.shards.len() + 2, "shards, meta.json and the rules");
    for artifact in artifacts {
        let path = artifact["path"].as_str().unwrap();
        let file = root.join("a").join(path.strip_prefix("selfplay/test/").unwrap());
        assert_eq!(artifact["bytes"], std::fs::metadata(file).unwrap().len());
    }
    assert_eq!(manifest["encoding"], "mighty-1");
    std::fs::remove_dir_all(&root).unwrap();
}

/// An eval-only dataset over a fixed list of rule sets: the evals'
/// held-out ones, measured on and never trained on.
#[test]
fn eval_only_datasets_play_a_listed_pool() {
    let root = scratch("eval");
    let pool: Vec<Rules> = [Preset::Gshs, Preset::Default].iter().map(|p| p.rules()).collect();
    std::fs::write(root.join("pool.json"), serde_json::to_string(&pool).unwrap()).unwrap();
    let config = Config {
        rules: "file:pool.json".into(),
        games: 12,
        eval_only: true,
        ..config(None)
    };
    let data = selfplay::run::<Mighty>(&config, &root, &root.join("out"), 2, |_| {}).unwrap();
    let played = read_rules(&root.join("out"));
    assert!(!played.is_empty() && played.iter().all(|r| pool.contains(r)));
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("out/meta.json")).unwrap()).unwrap();
    assert_eq!(meta["eval_only"], true);
    let provenance = Provenance {
        commit: "0".repeat(40),
        config: "research/experiments/x/config.toml".into(),
        created: "2026-10-05".into(),
    };
    let manifest = selfplay::manifest(&config, &data, &root.join("out"), "selfplay/eval", &provenance).unwrap();
    assert_eq!(manifest["kind"], "eval");
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn bad_configs_are_refused() {
    let root = scratch("bad");
    let run = |config: &Config| selfplay::run::<Mighty>(config, &root, &root.join("out"), 1, |_| {});
    let mut c = config(None);
    c.game = "poker".into();
    assert!(run(&c).is_err());
    let mut c = config(None);
    c.bots[0].spec = "genius".into();
    assert!(run(&c).is_err());
    let c = config(Some("missing.json"));
    assert!(run(&c).is_err());
    let mut c = config(None);
    c.rules = "file:missing.json".into();
    assert!(run(&c).is_err());
    assert!(Config::from_toml("name = 1").is_err());
    std::fs::remove_dir_all(&root).unwrap();
}
