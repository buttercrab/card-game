//! Field bots are told apart by what they do on fixed probe positions, so
//! two runs that name the same opponent but met another are flagged.

use eval::Research;
use eval::fingerprint::{PROBES, fingerprint, probes};
use mighty::Mighty;

fn print(name: &str) -> String {
    let spec = Mighty::parse_bot(name).unwrap();
    fingerprint::<Mighty>(&spec, &probes::<Mighty>())
}

#[test]
fn a_bot_has_one_fingerprint_and_another_bot_another() {
    assert_eq!(probes::<Mighty>().len(), PROBES);
    assert_eq!(print("normal"), print("normal"));
    assert_eq!(print("normal").len(), 16);
    // The same bot by another name is the same bot.
    assert_eq!(print("normal"), print("보통"));
    assert_ne!(print("normal"), print("random"));
    assert_ne!(print("normal"), print("simple@bid_base=30"));
}

#[test]
fn results_with_another_field_under_one_name_are_flagged() {
    let read = |json: serde_json::Value| -> eval::results::Results { serde_json::from_value(json).unwrap() };
    let mut a = serde_json::json!({
        "schema": "eval-results/1",
        "suite": { "name": "v1", "game": "mighty", "sha256": "0".repeat(64), "quick": true },
        "bot": "hard",
        "baseline": null,
        "reproducible": true,
        "run": { "commit": null, "dirty": false, "started": "", "wall_seconds": 1.0, "threads": 1, "command": [] },
        "machine": { "label": null, "os": "", "arch": "", "cpu": null, "threads": 1, "load": null },
        "ladder": null, "presets": null, "heldout": null, "matches": null, "cost": null, "puzzles": null
    });
    // Written before fingerprints: none, and nothing to flag.
    let old = read(a.clone());
    assert!(old.fingerprints.is_empty());
    a["fingerprints"] = serde_json::json!({ "normal": "aaaa", "random": "bbbb" });
    let mut b = a.clone();
    b["fingerprints"]["normal"] = "cccc".into();
    let (a, b) = (read(a), read(b));
    assert_eq!(a.differing_fields(&b), vec!["normal".to_string()]);
    assert!(a.differing_fields(&a).is_empty());
    assert!(old.differing_fields(&a).is_empty());
    assert!(eval::report::comparison(&a, &b).contains("FIELD DIFFERS: `normal`"));
}
