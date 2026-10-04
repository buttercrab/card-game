//! Rule sources, and that excluded rule sets (the evals' held-out ones)
//! never reach a hand.

use env::{EnvGame, Error, RuleSampler, RuleSource, load_excluded, rules_id, rules_key};
use mighty::Mighty;
use mighty::rules::{Preset, Rules};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

fn parse(text: &str) -> Result<RuleSource<Rules>, Error> {
    RuleSource::parse::<Mighty>(text)
}

#[test]
fn rule_sources_read_from_text() {
    assert_eq!(parse("gshs"), Ok(RuleSource::Fixed(Preset::Gshs.rules())));
    let four = Preset::Gshs.rules().for_players(4).unwrap();
    assert_eq!(parse(" gshs/4 "), Ok(RuleSource::Fixed(four.clone())));
    assert_eq!(
        parse("pool:default,gshs/4"),
        Ok(RuleSource::Pool(vec![Preset::Default.rules(), four]))
    );
    let all: Vec<Rules> = Preset::ALL.into_iter().map(Preset::rules).collect();
    assert_eq!(parse("varied"), Ok(RuleSource::Varied(all)));
    assert_eq!(parse("varied:sshs"), Ok(RuleSource::Varied(vec![Preset::Sshs.rules()])));
    let json = serde_json::to_string(&Preset::Kmla.rules()).unwrap();
    assert_eq!(parse(&json), Ok(RuleSource::Fixed(Preset::Kmla.rules())));
    assert_eq!(
        parse(&format!("[{json}]")),
        Ok(RuleSource::Pool(vec![Preset::Kmla.rules()]))
    );
    for bad in [
        "nowhere",
        "gshs/9",
        "gshs/x",
        "pool:",
        "{\"players\": 5}",
        "varied:default,nope",
    ] {
        assert!(matches!(parse(bad), Err(Error::Rules(_))), "{bad}");
    }
}

/// Varied draws the excluded list holds are drawn again; the sampler
/// still covers the space around them.
#[test]
fn excluded_rule_sets_are_never_drawn() {
    let source = parse("varied").unwrap();
    let draws = |sampler: &RuleSampler<Rules>, n| {
        let mut rng = ChaCha8Rng::seed_from_u64(1);
        (0..n)
            .map(|_| sampler.draw::<Mighty>(&mut rng).unwrap())
            .collect::<Vec<_>>()
    };
    let free = draws(&RuleSampler::new(source.clone(), Vec::new()).unwrap(), 40);
    // Hold out every other early draw: the same stream must now avoid them.
    let held_out: Vec<Rules> = free.iter().step_by(2).cloned().collect();
    let sampler = RuleSampler::new(source, held_out.clone()).unwrap();
    let drawn = draws(&sampler, 2000);
    assert!(drawn.iter().all(|r| !held_out.contains(r)));
    assert_ne!(drawn[0], free[0], "the first draw was held out, so it is redrawn");
}

#[test]
fn listed_rule_sets_may_not_be_excluded() {
    let held_out = vec![Preset::Gshs.rules()];
    for text in ["gshs", "pool:default,gshs"] {
        assert!(matches!(
            RuleSampler::new(parse(text).unwrap(), held_out.clone()),
            Err(Error::Rules(_))
        ));
    }
    // A varied base may be held out: varied draws differ from it.
    assert!(RuleSampler::new(parse("varied:gshs").unwrap(), held_out).is_ok());
}

/// The held-out file is a JSON array of serialized rule sets.
#[test]
fn excluded_rule_sets_load_from_a_json_array() {
    let mut rng = ChaCha8Rng::seed_from_u64(9);
    let sets: Vec<Rules> = (0..3)
        .map(|_| Mighty::vary(&Preset::Default.rules(), &mut rng))
        .collect();
    let path = std::env::temp_dir().join(format!("heldout-{}.json", std::process::id()));
    std::fs::write(&path, serde_json::to_string_pretty(&sets).unwrap()).unwrap();
    let loaded: Vec<Rules> = load_excluded(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    assert_eq!(loaded, sets);
    assert!(matches!(
        load_excluded::<Rules>(&path.with_extension("missing")),
        Err(Error::Io(_))
    ));
}

#[test]
fn rules_ids_follow_equality() {
    let (a, b) = (Preset::Gshs.rules(), Preset::Default.rules());
    assert_eq!(rules_id(&a), rules_id(&a.clone()));
    assert_ne!(rules_id(&a), rules_id(&b));
    assert_eq!(rules_id(&a).len(), 64);
    assert_eq!(format!("{:016x}", rules_key(&a)), rules_id(&a)[..16]);
}
