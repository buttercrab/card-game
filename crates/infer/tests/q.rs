//! Q networks from Rust: the fixture in `tests/tiny-q` is a small
//! untrained Q network with observations and the values PyTorch gave
//! their legal actions (`python -m cardgame_ml.export.fixture`); the
//! Python suite checks the same values against PyTorch.

use engine::{Bot, Game, Turn, Viewer};
use engine_ml::Encode;
use infer::{Parity, QBot, QNet};
use mighty::rules::Preset;
use mighty::{Action, Mighty, Options};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/tiny-q")
}

#[test]
fn values_match_pytorch() {
    let net = QNet::open(&fixture()).unwrap();
    let parity = Parity::load(&fixture().join("parity.json")).unwrap();
    let agreement = net.check_parity(&parity).unwrap();
    assert_eq!(agreement.observations, 6);
    assert!(
        agreement.max_abs_diff <= parity.tolerance,
        "values differ by up to {}",
        agreement.max_abs_diff
    );
}

#[test]
fn values_are_in_points_for_the_legal_actions_only() {
    let net = QNet::open(&fixture()).unwrap();
    let parity = Parity::load(&fixture().join("parity.json")).unwrap();
    let obs = &parity.observations[1];
    let raw = net.raw_values(&[obs]).unwrap();
    let points = net.values(&[obs]).unwrap();
    let legal: Vec<usize> = (0..obs.legal.len()).filter(|&i| obs.legal[i]).collect();
    assert_eq!(raw[0].iter().map(|&(a, _)| a).collect::<Vec<_>>(), legal);
    // The fixture's reward scale is 0.025: a point is 0.025 of the network's units.
    for (&(_, r), &(_, p)) in raw[0].iter().zip(&points[0]) {
        assert!((p - r / 0.025).abs() < 1e-3);
    }
    let mut idle = obs.clone();
    idle.legal.iter_mut().for_each(|l| *l = false);
    assert!(net.values(&[&idle]).unwrap()[0].is_empty());
}

/// One hand with a Q bot in every seat: its payoffs and every move.
fn play(net: &Arc<QNet>, options: &Options, seed: u64) -> (Vec<i64>, Vec<Action>) {
    let mut state = Mighty::new_game(options).unwrap();
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut bot = QBot {
        net: net.clone(),
        temperature: 1.0,
    };
    let mut moves = Vec::new();
    loop {
        match Mighty::turn(&state) {
            Turn::Over => break,
            Turn::Chance => {
                let deal = Mighty::sample_chance(&state, &mut rng);
                engine::apply_on_turn::<Mighty>(&mut state, deal).unwrap();
            }
            Turn::Seat(seat) => {
                let view = Mighty::view(&state, Viewer::Seat(seat));
                let legal = engine::legal_on_turn::<Mighty>(&state);
                let action = Bot::<Mighty>::act(&mut bot, &view, &legal, &mut rng);
                assert!(legal.contains(&action));
                moves.push(action.clone());
                engine::apply_on_turn::<Mighty>(&mut state, action).unwrap();
            }
        }
    }
    (Mighty::payoffs(&state).unwrap(), moves)
}

#[test]
fn a_q_bot_plays_whole_hands() {
    let net = Arc::new(QNet::open(&fixture()).unwrap());
    let options = Options {
        rules: Preset::ALL[0].rules(),
        first_bidder: 1,
    };
    assert_eq!(net.spec(), &Mighty::spec(&options).unwrap());
    // A few presets: the network runs unoptimised in a debug build.
    for preset in Preset::ALL.into_iter().step_by(3) {
        let options = Options {
            rules: preset.rules(),
            first_bidder: 1,
        };
        let (payoffs, moves) = play(&net, &options, 3);
        assert_eq!(payoffs.iter().sum::<i64>(), 0, "{preset:?}");
        assert_eq!(
            play(&net, &options, 3).1,
            moves,
            "{preset:?}: the same from the same seed"
        );
    }
}
