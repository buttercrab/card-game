//! Mighty through `engine::DynGame`: a hand played only with JSON goes
//! exactly as the same hand played through `Game`.

use engine::{DynError, DynState, Game, Registry, Turn, Viewer};
use mighty::rules::{Preset, Rules};
use mighty::{Action, Mighty, Options, State};
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde_json::{Value, json};

fn registry() -> Registry {
    Registry::new().with::<Mighty>()
}

/// Every view, seats and spectator, as JSON from both sides.
fn assert_same_views(dynamic: &dyn DynState, state: &State) {
    let viewers = (0..Mighty::seat_count(state))
        .map(Viewer::Seat)
        .chain([Viewer::Spectator]);
    for viewer in viewers {
        let typed = serde_json::to_value(Mighty::view(state, viewer)).unwrap();
        assert_eq!(dynamic.view(viewer), typed, "view for {viewer:?}");
    }
}

/// Plays one hand twice from the same seed, choosing the same action by
/// position in the legal list: once through JSON only, once through
/// `Game`. Returns the payoffs, which must agree.
fn play_both(rules: &Rules, first_bidder: usize, seed: u64) -> Vec<i64> {
    let options = Options {
        rules: rules.clone(),
        first_bidder,
    };
    let registry = registry();
    let game = registry.get("mighty").expect("mighty is registered");
    let mut dynamic = game.new_game(&serde_json::to_value(&options).unwrap()).unwrap();
    let mut state = Mighty::new_game(&options).unwrap();
    // Each side draws deals and choices from its own copy of one stream.
    let mut dyn_rng = ChaCha8Rng::seed_from_u64(seed);
    let mut rng = ChaCha8Rng::seed_from_u64(seed);

    loop {
        assert_eq!(dynamic.turn(), Mighty::turn(&state));
        assert_eq!(dynamic.seat_count(), Mighty::seat_count(&state));
        assert_same_views(dynamic.as_ref(), &state);
        let (json_action, action): (Value, Action) = match Mighty::turn(&state) {
            Turn::Over => break,
            Turn::Chance => (
                dynamic.sample_chance(&mut dyn_rng),
                Mighty::sample_chance(&state, &mut rng),
            ),
            Turn::Seat(_) => {
                let json_legal = dynamic.legal_actions();
                let legal = Mighty::legal_actions(&state);
                assert_eq!(json_legal.len(), legal.len());
                let i = dyn_rng.random_range(0..json_legal.len());
                assert_eq!(rng.random_range(0..legal.len()), i);
                (json_legal[i].clone(), legal[i].clone())
            }
        };
        dynamic.apply(&json_action).unwrap();
        Mighty::apply(&mut state, action).unwrap();
    }
    let payoffs = Mighty::payoffs(&state).expect("the hand is over");
    assert_eq!(dynamic.payoffs(), Some(payoffs.clone()));
    payoffs
}

#[test]
fn json_hands_play_out_as_typed_ones() {
    for preset in Preset::ALL {
        for seed in 0..5 {
            play_both(&preset.rules(), seed as usize % 5, seed);
        }
    }
    let mut rng = ChaCha8Rng::seed_from_u64(3);
    for seed in 0..20 {
        let rules = Preset::ALL[seed as usize % Preset::ALL.len()].rules().varied(&mut rng);
        play_both(&rules, 0, seed);
    }
}

#[test]
fn presets_and_rules_round_trip() {
    let registry = registry();
    let game = registry.get("mighty").unwrap();
    assert_eq!((game.id(), game.name()), ("mighty", "마이티"));
    let presets = game.presets();
    assert_eq!(presets.len(), Preset::ALL.len());
    for (info, preset) in presets.iter().zip(Preset::ALL) {
        assert_eq!(info.id, preset.name());
        assert_eq!(info.name, preset.title());
        assert_eq!(
            serde_json::from_value::<Rules>(info.rules.clone()).unwrap(),
            preset.rules()
        );
        assert_eq!(game.validate_rules(&info.rules), Ok(()));
    }
    let mut broken = presets[0].rules.clone();
    broken["hand_size"] = json!(0);
    assert!(matches!(game.validate_rules(&broken), Err(DynError::Game(_))));
    assert!(matches!(
        game.validate_rules(&json!("gshs")),
        Err(DynError::Json { .. })
    ));
    let options = json!({ "rules": presets[0].rules, "first_bidder": 9 });
    assert!(matches!(game.new_game(&options), Err(DynError::Game(_))), "no seat 9");
}

#[test]
fn illegal_json_actions_change_nothing() {
    let registry = registry();
    let game = registry.get("mighty").unwrap();
    let options = json!({ "rules": Preset::Gshs.rules(), "first_bidder": 0 });
    let mut hand = game.new_game(&options).unwrap();
    let deal = hand.sample_chance(&mut ChaCha8Rng::seed_from_u64(0));
    hand.apply(&deal).unwrap();
    let before = hand.view(Viewer::Spectator);
    // A bid below the minimum, then something that is not an action.
    let low = json!({ "Bid": { "trump": "Spade", "count": 1 } });
    assert!(matches!(hand.apply(&low), Err(DynError::Game(_))));
    assert!(matches!(hand.apply(&json!({ "Shout": 1 })), Err(DynError::Json { .. })));
    assert_eq!(hand.view(Viewer::Spectator), before);
}
