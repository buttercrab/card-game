//! The Rust runtime gives PyTorch's logits: the fixture in `tests/tiny`
//! is a small untrained belief model with observations and the logits
//! PyTorch gave for them (`python -m cardgame_ml.export.fixture`); the
//! Python suite checks the same logits against PyTorch.

use engine::{Game, Viewer};
use engine_ml::{Belief, Encode};
use infer::{BeliefNet, Parity};
use mighty::rules::Preset;
use mighty::{Mighty, Options};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use std::path::{Path, PathBuf};

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/tiny")
}

#[test]
fn logits_match_pytorch() {
    let net = BeliefNet::open(&fixture()).unwrap();
    let parity = Parity::load(&fixture().join("parity.json")).unwrap();
    let agreement = net.check_parity(&parity).unwrap();
    assert_eq!(agreement.observations, 6);
    assert!(
        agreement.max_abs_diff <= parity.tolerance,
        "logits differ by up to {}",
        agreement.max_abs_diff
    );
}

#[test]
fn the_model_reads_mightys_encoding() {
    let net = BeliefNet::open(&fixture()).unwrap();
    let options = Options {
        rules: Preset::ALL[0].rules(),
        first_bidder: 0,
    };
    let spec = Mighty::spec(&options).unwrap();
    assert_eq!(net.spec(), &spec);
    // A position, through the trait a search uses.
    let mut state = Mighty::new_game(&options).unwrap();
    let mut rng = ChaCha8Rng::seed_from_u64(1);
    let deal = Mighty::sample_chance(&state, &mut rng);
    engine::apply_on_turn::<Mighty>(&mut state, deal).unwrap();
    let view = Mighty::view(&state, Viewer::Seat(1));
    let obs = Mighty::encode(&view, &[]);
    let logits = (&net as &dyn Belief).logits(&[&obs, &obs]).unwrap();
    assert_eq!(logits.len(), 2);
    assert_eq!(logits[0].len(), spec.cards.len() * spec.belief_classes.len());
    assert_eq!(logits[0], logits[1]);
    assert!(logits[0].iter().all(|x| x.is_finite()));
}

#[test]
fn malformed_observations_are_refused() {
    let net = BeliefNet::open(&fixture()).unwrap();
    let parity = Parity::load(&fixture().join("parity.json")).unwrap();
    let mut obs = parity.observations[0].clone();
    obs.cards.pop();
    assert!(net.run(&[&obs]).is_err());
    assert!(net.run(&[]).unwrap().is_empty());
}
