//! Bots by name: the table's levels play exactly as mighty::bot::Level
//! builds them, the server's bots included.

use engine::{Game, Turn, Viewer};
use env::EnvGame;
use mighty::Mighty;
use mighty::bot::Level;
use mighty::rules::Preset;
use rand::SeedableRng;
use rand::rngs::StdRng;
use rand::seq::IndexedRandom;
use rand_chacha::ChaCha8Rng;
use sim::spec::Kind;

#[test]
fn names_parse() {
    assert!(matches!(
        Mighty::parse_bot("초보").map(|s| s.kind),
        Ok(Kind::Clumsy(..))
    ));
    assert!(matches!(
        Mighty::parse_bot("normal").map(|s| s.kind),
        Ok(Kind::Simple(_))
    ));
    let Ok(Kind::Search(hard)) = Mighty::parse_bot("고수").map(|s| s.kind) else {
        panic!("고수 searches")
    };
    assert_eq!(Some(hard), Level::Hard.search());
    assert!(Mighty::parse_bot("search:50:1:0").is_ok());
    assert!(Mighty::parse_bot("simple@bid_base=7").is_ok());
    for bad in ["hard:x", "hard:50", "easy:3", "genius"] {
        assert!(Mighty::parse_bot(bad).is_err(), "{bad}");
    }
}

/// 초보 and 보통 choose what the levels themselves choose (and so the
/// server's bots), seat by seat, given the same randomness, at every
/// position of random games.
#[test]
fn levels_play_as_the_levels_build() {
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
                    for (name, level) in [("초보", Level::Easy), ("normal", Level::Normal)] {
                        let seed = decisions as u64;
                        let spec = Mighty::parse_bot(name).unwrap();
                        let ours =
                            <Mighty as EnvGame>::bot(&spec, seat).act(&view, &legal, &mut StdRng::seed_from_u64(seed));
                        let theirs = level
                            .build(seat, None)
                            .act(&view, &legal, &mut StdRng::seed_from_u64(seed));
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
