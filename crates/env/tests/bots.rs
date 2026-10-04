//! Bots by name: the table's levels play exactly as the server's do.

use engine::{Game, Turn, Viewer};
use env::EnvGame;
use env::mighty::BotSpec;
use mighty::Mighty;
use mighty::rules::Preset;
use rand::SeedableRng;
use rand::rngs::StdRng;
use rand::seq::IndexedRandom;
use rand_chacha::ChaCha8Rng;
use server::session::{BotLevel, SessionGame};
use std::time::Duration;

#[test]
fn names_parse() {
    assert!(matches!(Mighty::parse_bot("초보"), Ok(BotSpec::Easy)));
    assert!(matches!(Mighty::parse_bot("normal"), Ok(BotSpec::Normal)));
    assert!(matches!(Mighty::parse_bot("고수"), Ok(BotSpec::Hard(None))));
    assert!(matches!(Mighty::parse_bot("hard:50"), Ok(BotSpec::Hard(Some(50)))));
    assert!(matches!(Mighty::parse_bot("search:50:1:0"), Ok(BotSpec::Sim(_))));
    assert!(matches!(Mighty::parse_bot("simple@bid_base=7"), Ok(BotSpec::Sim(_))));
    for bad in ["hard:x", "easy:3", "genius"] {
        assert!(Mighty::parse_bot(bad).is_err(), "{bad}");
    }
}

/// 초보 and 보통 choose what the server's bots of those levels choose,
/// seat by seat, given the same randomness, at every position of random
/// games. (고수 differs only in having no time limit.)
#[test]
fn levels_play_as_on_the_server() {
    let mut rng = ChaCha8Rng::seed_from_u64(2);
    let mut decisions = 0;
    for (game, preset) in Preset::ALL.into_iter().cycle().take(18).enumerate() {
        let rules = preset.rules().for_players(3 + game % 5).unwrap();
        let options = mighty::Options { first_bidder: 0, rules };
        let mut state = Mighty::new_game(&options).unwrap();
        loop {
            let action = match Mighty::turn(&state) {
                Turn::Over => break,
                Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                Turn::Seat(seat) => {
                    let view = Mighty::view(&state, Viewer::Seat(seat));
                    let legal = Mighty::legal_actions(&state);
                    for (spec, level) in [(BotSpec::Easy, BotLevel::Easy), (BotSpec::Normal, BotLevel::Normal)] {
                        let seed = decisions as u64;
                        let ours =
                            <Mighty as EnvGame>::bot(&spec, seat).act(&view, &legal, &mut StdRng::seed_from_u64(seed));
                        let theirs = <Mighty as SessionGame>::bot(level, seat, Duration::ZERO, 1).act(
                            &view,
                            &legal,
                            &mut StdRng::seed_from_u64(seed),
                        );
                        assert_eq!(ours, theirs, "{level:?} in seat {seat}");
                    }
                    decisions += 1;
                    legal.choose(&mut rng).unwrap().clone()
                }
            };
            Mighty::apply(&mut state, action).unwrap();
        }
    }
    assert!(decisions > 500);
}
