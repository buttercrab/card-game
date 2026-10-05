//! The search bot's decisions, pinned: whole hands of search bots over
//! presets and varied rules, every action hashed. Faster searches and new
//! settings that are off must reproduce this exactly. (Comparing two
//! builds' eval digests checks many more hands; this one runs in CI.)

use engine::{Bot, Game, Turn, Viewer};
use mighty::rules::{Preset, Rules};
use mighty::search::SearchBot;
use mighty::{Action, Mighty, Options};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

/// FNV-1a over the actions' debug text.
struct Fingerprint(u64);

impl Fingerprint {
    fn add(&mut self, action: &Action) {
        for b in format!("{action:?}").bytes() {
            self.0 = (self.0 ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3);
        }
    }
}

/// Plays a hand with `bot` in every seat; every action goes into `print`.
fn play(rules: Rules, seed: u64, bot: SearchBot, print: &mut Fingerprint) {
    let players = rules.players;
    let options = Options {
        rules,
        first_bidder: seed as usize % players,
    };
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut bots: Vec<SearchBot> = vec![bot; players];
    let mut state = Mighty::new_game(&options).unwrap();
    loop {
        let action = match Mighty::turn(&state) {
            Turn::Over => return,
            Turn::Chance => Mighty::sample_chance(&state, &mut rng),
            Turn::Seat(seat) => {
                let view = Mighty::view(&state, Viewer::Seat(seat));
                bots[seat].act(&view, &Mighty::legal_actions(&state), &mut rng)
            }
        };
        print.add(&action);
        Mighty::apply(&mut state, action).unwrap();
    }
}

#[test]
fn search_decisions_are_pinned() {
    let bot = SearchBot {
        samples: 4,
        budget: None,
        ..SearchBot::default()
    };
    let mut print = Fingerprint(0xcbf2_9ce4_8422_2325);
    let mut rng = ChaCha8Rng::seed_from_u64(11);
    for (i, preset) in Preset::ALL.into_iter().enumerate().step_by(3) {
        let players = 3 + i % 5;
        play(preset.rules().for_players(players).unwrap(), i as u64, bot, &mut print);
        play(preset.rules().varied(&mut rng), 100 + i as u64, bot, &mut print);
    }
    assert_eq!(
        print.0, 0x48fc_498f_9717_cfd2,
        "the search decides differently: only re-pin for a change that means to"
    );
}
