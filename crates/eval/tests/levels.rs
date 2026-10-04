//! The ladder's 초보 and 보통 are the bots the tables seat: given the same
//! position and random stream, `easy` and `normal` choose what the
//! server's `SessionGame::bot` chooses, seat by seat. (고수 differs from
//! the table's on purpose: it deals a fixed 200 times instead of until a
//! clock runs out.)

use engine::{Bot, Game, RandomBot, Turn, Viewer};
use mighty::rules::Preset;
use mighty::{Mighty, Options};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use server::session::{BotLevel, SessionGame};
use sim::spec::Spec;
use std::time::Duration;

#[test]
fn easy_and_normal_are_the_tables_bots() {
    for (name, level) in [("easy", BotLevel::Easy), ("normal", BotLevel::Normal)] {
        let spec: Spec = name.parse().expect("a level");
        let mut decisions = 0;
        for deal in 0..20u64 {
            let rules = Preset::Gshs.rules();
            let options = Options {
                first_bidder: deal as usize % rules.players,
                rules,
            };
            let mut state = Mighty::new_game(&options).expect("valid");
            let mut rng = ChaCha8Rng::seed_from_u64(deal);
            // Random play reaches positions of every kind; both bots are
            // asked at each.
            loop {
                let action = match Mighty::turn(&state) {
                    Turn::Over => break,
                    Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                    Turn::Seat(seat) => {
                        let legal = Mighty::legal_actions(&state);
                        let view = Mighty::view(&state, Viewer::Seat(seat));
                        let ask =
                            |bot: &mut dyn Bot<Mighty>| bot.act(&view, &legal, &mut ChaCha8Rng::seed_from_u64(deal));
                        let table = ask(&mut *<Mighty as SessionGame>::bot(level, seat, Duration::ZERO, 1));
                        assert_eq!(ask(&mut *spec.build(seat)), table, "{name}, deal {deal}, seat {seat}");
                        decisions += 1;
                        Bot::<Mighty>::act(&mut RandomBot, &view, &legal, &mut rng)
                    }
                };
                Mighty::apply(&mut state, action).expect("legal");
            }
        }
        assert!(decisions > 1000);
    }
}
