//! What a field bot does, in a few hex digits: its choices on fixed probe
//! positions, hashed. Two runs that name the same opponent but meet a
//! different one (the bot changed between commits, a model directory now
//! holds another network) get different fingerprints, so comparing their
//! numbers is flagged ([`crate::results::Results::differing_fields`]).

use crate::EvalGame;
use engine::{Bot, RandomBot, Seat, Viewer};
use harness::Decided;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use sha2::{Digest, Sha256};

/// Probe positions a fingerprint asks about.
pub const PROBES: usize = 16;

/// Probe positions: decisions of seats in hands random bots play from
/// fixed seeds, under the game's first preset, one in every few so they
/// cover the whole hand.
pub fn probes<G: EvalGame>() -> Vec<(G::State, Seat)> {
    let Some((_, _, rules)) = G::presets().into_iter().next() else {
        return Vec::new();
    };
    let mut out: Vec<(G::State, Seat)> = Vec::new();
    for deal in 0..64 {
        let mut rng = ChaCha8Rng::seed_from_u64(deal);
        let mut picker = ChaCha8Rng::seed_from_u64(deal);
        picker.set_stream(1);
        let Ok(mut state) = G::new_game(&G::options(&rules, deal)) else {
            return out;
        };
        let mut decisions = 0u64;
        let mut keep = |d: Decided<G>| {
            decisions += 1;
            if d.legal.len() > 1 && (decisions + deal).is_multiple_of(7) && out.len() < PROBES {
                out.push((d.state.clone(), d.seat));
            }
        };
        let mut random = |state: &G::State, seat: Seat, legal: &[G::Action]| {
            let view = G::view(state, Viewer::Seat(seat));
            <RandomBot as Bot<G>>::act(&mut RandomBot, &view, legal, &mut picker)
        };
        // A hand that cannot go on still leaves the probes it gave.
        let _ = harness::drive::<G>(
            &mut state,
            &mut rng,
            &mut random,
            &|_| false,
            &mut keep,
            &mut Vec::new(),
        );
        if out.len() == PROBES {
            break;
        }
    }
    out
}

/// The fingerprint of the bot `spec` names: its choice at every probe
/// (built afresh for the probe's seat, on a generator seeded by the
/// probe), hashed; 16 hex digits. A bot on a clock may choose otherwise
/// from run to run, and so differ from itself.
pub fn fingerprint<G: EvalGame>(spec: &G::Spec, probes: &[(G::State, Seat)]) -> String {
    let mut hash = Sha256::new();
    for (i, (state, seat)) in probes.iter().enumerate() {
        let view = G::view(state, Viewer::Seat(*seat));
        let legal = engine::legal_on_turn::<G>(state);
        let mut bot = G::bot(spec, *seat);
        let action = bot.act(&view, &legal, &mut ChaCha8Rng::seed_from_u64(i as u64));
        hash.update(format!("{i} {action:?}\n").as_bytes());
    }
    hash.finalize()[..8].iter().map(|b| format!("{b:02x}")).collect()
}
