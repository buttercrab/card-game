//! The model encoding (`mighty::encode`): its shape, that it sees only the
//! view, that every legal action has its own index, and that belief
//! targets say where hidden cards really are.

use engine::{Game, Turn, Viewer};
use engine_ml::{Encode, Observation, Spec};
use mighty::card::{ACE, Card, Color, Suit};
use mighty::encode::{ACTIONS, BURIED, MAX_EVENTS, MAX_SEATS, SLOTS};
use mighty::rules::{Preset, Rules};
use mighty::testing::Pinned;
use mighty::{Action, Mighty, Options, State};
use rand::seq::IndexedRandom;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;

fn options(rules: Rules, first_bidder: usize) -> Options {
    Options { rules, first_bidder }
}

/// Plays one game with random moves, calling `visit` on every position
/// before it is played from, the last one included.
fn play(options: &Options, seed: u64, mut visit: impl FnMut(&State)) {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut state = Mighty::new_game(options).unwrap();
    loop {
        visit(&state);
        let action = match Mighty::turn(&state) {
            Turn::Over => return,
            Turn::Chance => Mighty::sample_chance(&state, &mut rng),
            Turn::Seat(_) => engine::legal_on_turn::<Mighty>(&state)
                .choose(&mut rng)
                .unwrap()
                .clone(),
        };
        engine::apply_on_turn::<Mighty>(&mut state, action).unwrap();
    }
}

/// Rule sets to cover: every preset at every table size, and `--vary` draws.
fn rule_sets() -> Vec<Rules> {
    let mut sets: Vec<Rules> = Preset::ALL
        .into_iter()
        .flat_map(|p| (3..=7).map(move |n| p.rules().for_players(n).unwrap()))
        .collect();
    let mut rng = ChaCha8Rng::seed_from_u64(7);
    for preset in Preset::ALL {
        for _ in 0..6 {
            sets.push(preset.rules().varied(&mut rng));
        }
    }
    sets
}

fn legal_for(state: &State, seat: usize) -> Vec<Action> {
    if Mighty::turn(state) == Turn::Seat(seat) {
        engine::legal_on_turn::<Mighty>(state)
    } else {
        Vec::new()
    }
}

fn encode(state: &State, seat: usize) -> Observation {
    let view = Mighty::view(state, Viewer::Seat(seat));
    Mighty::encode(&view, &legal_for(state, seat))
}

fn spec() -> Spec {
    Mighty::spec(&options(Rules::web_mighty(), 0)).unwrap()
}

/// One card's value of a named card feature.
fn card_feature(spec: &Spec, obs: &Observation, card: Card, name: &str) -> f32 {
    let column = spec
        .card_features
        .iter()
        .position(|n| n == name)
        .unwrap_or_else(|| panic!("no {name}"));
    obs.cards[card.slot() * spec.card_features.len() + column]
}

fn global_feature(spec: &Spec, obs: &Observation, name: &str) -> f32 {
    let i = spec
        .global
        .iter()
        .position(|n| n == name)
        .unwrap_or_else(|| panic!("no {name}"));
    obs.global[i]
}

#[test]
fn one_spec_fits_every_rule_set() {
    let spec = spec();
    assert_eq!(spec.cards.len(), SLOTS);
    assert_eq!(spec.actions.len(), ACTIONS);
    assert_eq!(spec.max_events, MAX_EVENTS);
    assert_eq!(spec.belief_classes.len(), MAX_SEATS + 1);
    for rules in rule_sets() {
        assert_eq!(Mighty::spec(&options(rules, 0)).as_ref(), Ok(&spec));
    }
    for names in [&spec.global, &spec.card_features, &spec.event_features, &spec.actions] {
        let mut sorted = names.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), names.len(), "feature names are unique");
    }
}

#[test]
fn rules_beyond_the_action_space_are_refused() {
    let mut rules = Rules::web_mighty();
    rules.bidding.max = 31;
    assert!(Mighty::spec(&options(rules, 0)).is_err());
    let rules = Rules {
        hand_size: 0,
        ..Rules::web_mighty()
    };
    assert!(Mighty::spec(&options(rules, 0)).is_err(), "invalid rules");
}

/// The spec defines what every model sees, so it changes only on purpose:
/// with a new `VERSION`, and this snapshot rewritten by the ignored test
/// below. The Python side reads the same file.
#[test]
fn spec_matches_the_snapshot() {
    let pinned: Spec = serde_json::from_str(include_str!("encoding.json")).expect("the snapshot parses");
    assert_eq!(
        spec(),
        pinned,
        "the encoding changed; bump VERSION and rewrite tests/encoding.json"
    );
}

/// FNV-1a of the spec's JSON, its version left out: what
/// [`mighty::encode::SPECS`] lists for each version.
fn spec_fingerprint(spec: &Spec) -> u64 {
    let mut unversioned = spec.clone();
    unversioned.version = String::new();
    let mut fingerprint = Fingerprint::new();
    fingerprint.add(serde_json::to_string(&unversioned).unwrap().as_bytes());
    fingerprint.0
}

/// A changed spec needs a new `VERSION`: the last of `SPECS` names the
/// current version and its spec, and no version is listed twice.
#[test]
fn the_spec_changes_only_with_its_version() {
    use mighty::encode::{SPECS, VERSION};
    let (version, pinned) = *SPECS.last().unwrap();
    assert_eq!(version, VERSION, "the last line of SPECS is for VERSION");
    let now = spec_fingerprint(&spec());
    assert_eq!(
        pinned, now,
        "the encoding spec changed (now {now:#018x}): bump VERSION, append (VERSION, {now:#018x}) to SPECS \
         in crates/mighty/src/encode.rs and run scripts/regenerate-fixtures.sh"
    );
    for (i, (version, fingerprint)) in SPECS.iter().enumerate() {
        for (other, other_fingerprint) in &SPECS[i + 1..] {
            assert_ne!(version, other, "{version} is listed twice");
            assert_ne!(
                fingerprint, other_fingerprint,
                "{version} and {other} have the same spec"
            );
        }
    }
}

#[test]
#[ignore]
fn write_spec_snapshot() {
    let json = serde_json::to_string_pretty(&spec()).unwrap();
    std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/encoding.json"), json + "\n").unwrap();
}

/// FNV-1a, 64 bits: enough to notice any change to a stream of numbers.
struct Fingerprint(u64);

impl Fingerprint {
    fn new() -> Fingerprint {
        Fingerprint(0xcbf2_9ce4_8422_2325)
    }

    fn add(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3);
        }
    }

    fn observation(&mut self, obs: &Observation) {
        for x in obs.global.iter().chain(&obs.cards).chain(&obs.events) {
            self.add(&x.to_bits().to_le_bytes());
        }
        for c in &obs.event_cards {
            self.add(&c.to_le_bytes());
        }
        self.add(&obs.events_len.to_le_bytes());
        self.add(&obs.legal.iter().map(|&l| u8::from(l)).collect::<Vec<_>>());
    }
}

/// What every seat sees at every position of a fixed set of random games,
/// bit for bit, one line per game in `tests/pinned/encodings.jsonl`. The
/// games' rules are frozen (`tests/pinned/encode-games.json`), so only a
/// change to the encoding moves this, and then `VERSION` changes too.
/// Faster encoders must reproduce it exactly.
fn pinned() -> Pinned {
    Pinned::of("mighty", env!("CARGO_MANIFEST_DIR"))
}

fn pinned_encodings() -> Vec<String> {
    pinned()
        .games("encode-games.json")
        .iter()
        .enumerate()
        .map(|(game, pinned)| {
            let players = pinned.rules.players;
            let mut fingerprint = Fingerprint::new();
            let mut positions = 0;
            play(&pinned.options(), pinned.seed, |state| {
                for seat in 0..players {
                    fingerprint.observation(&encode(state, seat));
                    positions += 1;
                }
            });
            format!(
                r#"{{"game": {game}, "players": {players}, "positions": {positions}, "fingerprint": "{:016x}"}}"#,
                fingerprint.0
            )
        })
        .collect()
}

#[test]
fn encodings_are_pinned() {
    pinned().check("encodings.jsonl", &pinned_encodings(), "encode");
}

#[test]
#[ignore]
fn write_pinned_encodings() {
    pinned().write("encodings.jsonl", &pinned_encodings());
}

/// Each legal action of every position of many random games has its own
/// index, which maps back to it.
#[test]
fn every_legal_action_round_trips() {
    let mut decisions = 0;
    for (i, rules) in rule_sets().into_iter().enumerate() {
        let players = rules.players;
        let options = options(rules, i % players);
        for seed in 0..4 {
            play(&options, seed, |state| {
                let Turn::Seat(seat) = Mighty::turn(state) else { return };
                decisions += 1;
                let view = Mighty::view(state, Viewer::Seat(seat));
                let legal = engine::legal_on_turn::<Mighty>(state);
                let mut seen = vec![false; ACTIONS];
                for action in &legal {
                    let index = Mighty::action_index(&view, action).unwrap_or_else(|| panic!("{action:?}"));
                    assert!(!seen[index], "two legal actions share index {index}");
                    seen[index] = true;
                    assert_eq!(Mighty::action_from_index(&view, &legal, index).as_ref(), Some(action));
                }
                assert_eq!(Mighty::legal_mask(&view, &legal, ACTIONS), seen);
            });
        }
    }
    assert!(decisions > 10_000, "only {decisions} decisions");
}

/// Every position, every seat: the spec's shape, finite values, the same
/// encoding twice, and the legal mask for the seat to act.
#[test]
fn every_position_fits_the_spec() {
    let spec = spec();
    for (i, rules) in rule_sets().into_iter().enumerate() {
        let players = rules.players;
        play(&options(rules, i % players), i as u64, |state| {
            for seat in 0..players {
                let obs = encode(state, seat);
                spec.check(&obs).unwrap_or_else(|e| panic!("{e}"));
                assert!(
                    obs.global
                        .iter()
                        .chain(&obs.cards)
                        .chain(&obs.events)
                        .all(|x| x.is_finite())
                );
                let legal = legal_for(state, seat);
                assert_eq!(obs.legal.iter().filter(|&&l| l).count(), legal.len());
                if !legal.is_empty() {
                    assert_eq!(obs, encode(state, seat), "encoding is deterministic");
                }
            }
        });
    }
}

/// Two states that differ only in what a seat cannot see encode the same
/// for that seat.
#[test]
fn encodings_see_only_the_view() {
    let mut rng = ChaCha8Rng::seed_from_u64(1);
    for (i, rules) in rule_sets().into_iter().enumerate().step_by(3) {
        let players = rules.players;
        play(&options(rules, i % players), i as u64, |state| {
            let seat = rng.random_range(0..players);
            let other = Mighty::reshuffle_hidden(state, Viewer::Seat(seat), &mut rng);
            assert_eq!(encode(state, seat), encode(&other, seat));
        });
    }
}

/// A target names the hand that holds the card, or the buried cards, for
/// exactly the cards the encoding marks unseen.
#[test]
fn belief_targets_say_where_hidden_cards_are() {
    let spec = spec();
    for (i, rules) in rule_sets().into_iter().enumerate().step_by(2) {
        let players = rules.players;
        play(&options(rules, i % players), i as u64, |state| {
            let dealt = !matches!(Mighty::turn(state), Turn::Chance);
            let hands: Vec<Vec<Card>> = (0..players)
                .map(|s| Mighty::view(state, Viewer::Seat(s)).hand)
                .collect();
            for seat in 0..players {
                let targets = Mighty::belief_targets(state, seat);
                let obs = encode(state, seat);
                assert_eq!(targets.len(), SLOTS);
                let mut held = [0; MAX_SEATS];
                for (slot, &target) in targets.iter().enumerate() {
                    let card = Card::from_slot(slot);
                    let unseen = card_feature(&spec, &obs, card, "unseen") == 1.0;
                    assert_eq!(target >= 0, unseen && dealt, "{card} for seat {seat}");
                    if target == BURIED {
                        assert!(hands.iter().all(|h| !h.contains(&card)), "{card} is buried");
                    } else if target >= 0 {
                        let k = target as usize;
                        assert!(k > 0 && k < players, "a hidden card in seat+{k}");
                        assert!(hands[(seat + k) % players].contains(&card), "{card} in seat+{k}");
                        held[k] += 1;
                    }
                }
                // Every card of every other hand is a target.
                for k in 1..players {
                    assert_eq!(held[k], hands[(seat + k) % players].len());
                }
            }
        });
    }
}

/// Deals 기본 with seat 0 holding `hand`.
fn basic_with(hand: &[Card]) -> State {
    let rules = Preset::Default.rules();
    let mut state = Mighty::new_game(&options(rules.clone(), 0)).unwrap();
    let mut rest: Vec<Card> = rules.cards().into_iter().filter(|c| !hand.contains(c)).collect();
    let mut hands = vec![hand.to_vec()];
    for _ in 1..rules.players {
        hands.push(rest.drain(..rules.hand_size).collect());
    }
    engine::apply_on_turn::<Mighty>(&mut state, Action::Deal { hands, kitty: rest }).unwrap();
    state
}

#[test]
fn card_rows_carry_what_the_rules_make_of_a_card() {
    let spec = spec();
    let c = Card::new;
    let joker = Card::Joker(Color::Black);
    let hand = [
        c(Suit::Spade, ACE),
        c(Suit::Club, 3),
        joker,
        c(Suit::Heart, 10),
        c(Suit::Heart, 2),
        c(Suit::Diamond, 2),
        c(Suit::Diamond, 3),
        c(Suit::Diamond, 4),
        c(Suit::Diamond, 5),
        c(Suit::Diamond, 6),
    ];
    let state = basic_with(&hand);
    let obs = encode(&state, 0);
    let feature = |card, name| card_feature(&spec, &obs, card, name);

    assert_eq!(feature(c(Suit::Spade, ACE), "mine"), 1.0);
    assert_eq!(feature(c(Suit::Spade, 13), "unseen"), 1.0);
    assert_eq!(feature(Card::Joker(Color::Red), "in_deck"), 0.0, "기본 has one joker");
    // No bid yet: no trump, so ♠A is the mighty and ♣3 calls the joker.
    assert_eq!(feature(c(Suit::Spade, ACE), "mighty"), 1.0);
    assert_eq!(feature(c(Suit::Club, 3), "joker_caller"), 1.0);
    assert_eq!(feature(c(Suit::Heart, 10), "point"), 1.0);
    // Tens count ½ toward a misdeal in 기본 (doubled to 1), the joker −1 (−2).
    assert_eq!(feature(c(Suit::Heart, 10), "misdeal_value"), 0.25);
    assert_eq!(feature(joker, "misdeal_value"), -0.5);
    // The joker has no power on the first and last tricks.
    assert_eq!(feature(joker, "policy.first=no_effect"), 1.0);
    // Nothing beats the mighty; within a suit, higher cards hold better.
    assert_eq!(feature(c(Suit::Spade, ACE), "strength"), 1.0);
    assert!(feature(c(Suit::Heart, 2), "strength") < feature(c(Suit::Heart, 10), "strength"));
    assert!(feature(c(Suit::Heart, 10), "strength") < feature(joker, "strength"));
    assert_eq!(global_feature(&spec, &obs, "phase=bidding"), 1.0);
    assert_eq!(global_feature(&spec, &obs, "rules.players=5"), 1.0);

    // Once ♠ is the trump bid, the mighty moves to ♦A.
    let mut state = state;
    let spades = mighty::rules::Contract {
        trump: Some(Suit::Spade),
        count: 14,
    };
    engine::apply_on_turn::<Mighty>(&mut state, Action::Bid(spades)).unwrap();
    let obs = encode(&state, 1);
    let feature = |card, name| card_feature(&spec, &obs, card, name);
    assert_eq!(feature(c(Suit::Diamond, ACE), "mighty"), 1.0);
    assert_eq!(feature(c(Suit::Spade, ACE), "mighty"), 0.0);
    // ♣3 still calls the joker; ♠3 would only with clubs trump.
    assert_eq!(feature(c(Suit::Club, 3), "joker_caller"), 1.0);
    assert_eq!(feature(c(Suit::Spade, 3), "joker_caller"), 0.0);
    assert_eq!(feature(c(Suit::Spade, 2), "trump"), 1.0);
    // Seat 0 bid; seat 1 sees it one seat back, as relative seat 4.
    assert_eq!(global_feature(&spec, &obs, "seat.best_bidder[4]"), 1.0);
    assert_eq!(global_feature(&spec, &obs, "seat.to_act[0]"), 1.0);
}

#[test]
fn friend_calls_by_seat_are_relative() {
    let rules = Rules::web_mighty();
    let view = |seat| {
        let state = Mighty::new_game(&options(rules.clone(), 0)).unwrap();
        Mighty::view(&state, Viewer::Seat(seat))
    };
    let call = |seat| Action::CallFriend(mighty::FriendCall::Seat(seat));
    // The seat after the caller has one index whoever calls.
    assert_eq!(
        Mighty::action_index(&view(0), &call(1)),
        Mighty::action_index(&view(3), &call(4))
    );
    assert_eq!(
        Mighty::action_index(&view(4), &call(0)),
        Mighty::action_index(&view(0), &call(1))
    );
    assert_eq!(
        Mighty::action_index(
            &view(0),
            &Action::Deal {
                hands: vec![],
                kitty: vec![]
            }
        ),
        None
    );
}
