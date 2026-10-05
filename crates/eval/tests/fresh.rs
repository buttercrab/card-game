//! The experiment loop's own suites (`research/loop/suites`). Fresh-deal
//! suites are the scoreboard's parts with every seed moved, naming the
//! scoreboard's held-out file by a relative path and hash: the loop
//! confirms a win on one, and this checks the runner reads it as the same
//! tables on new deals. Every loop suite names only bots and presets that
//! exist.

use eval::suite::{Loaded, RulesRef};
use eval::{EvalGame, preset};
use mighty::Mighty;

const ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
/// `cardgame_ml.loop.evals.FRESH_SEED_STRIDE`.
const STRIDE: u64 = 10_000_000;

fn load(path: &str) -> Loaded {
    Loaded::load(&format!("{ROOT}/{path}")).unwrap_or_else(|e| panic!("{e}"))
}

#[test]
fn fresh_suites_are_the_scoreboard_on_new_deals() {
    let v1 = load("research/evals/v1");
    let dir = format!("{ROOT}/research/loop/suites");
    let mut checked = 0;
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_str().unwrap().to_string();
        let Some(k) = name.strip_prefix("v1-fresh-") else {
            continue;
        };
        let k: u64 = k.parse().unwrap();
        let fresh = load(&format!("research/loop/suites/{name}"));
        let (a, b) = (&v1.suite, &fresh.suite);
        assert_eq!(b.suite, name);
        assert_eq!(a.game, b.game);
        assert!(b.cost.is_none() && b.puzzles.is_none() && b.matches.is_none());

        let (la, lb) = (a.ladder.as_ref().unwrap(), b.ladder.as_ref().unwrap());
        assert_eq!(lb.seed, la.seed + k * STRIDE);
        assert_eq!((&la.rules, la.deals), (&lb.rules, lb.deals));
        let rungs = |l: &eval::suite::Ladder| l.rungs.iter().map(|r| r.field.clone()).collect::<Vec<_>>();
        assert_eq!(rungs(la), rungs(lb));

        let (pa, pb) = (a.presets.as_ref().unwrap(), b.presets.as_ref().unwrap());
        assert_eq!(pb.seed, pa.seed + k * STRIDE);
        assert_eq!((&pa.field, pa.deals, &pa.presets), (&pb.field, pb.deals, &pb.presets));

        let (ha, hb) = (a.heldout.as_ref().unwrap(), b.heldout.as_ref().unwrap());
        assert_eq!(hb.seed, ha.seed + k * STRIDE);
        assert_eq!((&ha.field, ha.deals, &ha.sha256), (&hb.field, hb.deals, &hb.sha256));
        // The same file, found from the fresh suite's folder, hash checked.
        assert_eq!(
            fresh.read(&hb.file, &hb.sha256).unwrap(),
            v1.read(&ha.file, &ha.sha256).unwrap()
        );
        checked += 1;
    }
    assert!(checked > 0, "no fresh-deal suite in {dir}");
}

#[test]
fn loop_suites_name_bots_and_rules_that_exist() {
    let dir = format!("{ROOT}/research/loop/suites");
    for entry in std::fs::read_dir(&dir).unwrap() {
        let name = entry.unwrap().file_name().into_string().unwrap();
        let loaded = load(&format!("research/loop/suites/{name}"));
        assert_eq!(loaded.suite.suite, name);
        for m in loaded.suite.matches.iter().flatten() {
            Mighty::parse_bot(&m.field).unwrap_or_else(|e| panic!("{name}: {e}"));
            let RulesRef::Preset(id) = &m.rules else {
                panic!("{name}: {} names its rules by preset", m.name)
            };
            preset::<Mighty>(id).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(m.deals % 25, 0, "{name}: whole rotations of five seats");
        }
    }
}
