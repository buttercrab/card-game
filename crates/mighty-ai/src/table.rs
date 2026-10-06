//! Mighty's bots at the server's tables ([`engine::TableBots`]): what plays
//! at each level, the 딜미스 a bot calls off its turn, and the kind of
//! decision a seat faces, which sets a bot's pace.

use crate::level::LevelBots;
use crate::simple::tempered;
use engine::{Bot, Decision, Level, Seat, TableBots};
use mighty::{Action, Mighty, PhaseView, View};
use std::time::Duration;

/// The bots at Mighty's tables.
#[derive(Debug, Clone, Copy, Default)]
pub struct MightyBots;

impl TableBots<Mighty> for MightyBots {
    /// Its own default is a second: tables always think against a clock.
    fn bot(&self, level: Level, temper: usize, think: Duration, threads: usize) -> Box<dyn Bot<Mighty> + Send> {
        let think = if think.is_zero() { Duration::from_secs(1) } else { think };
        level.build_on(temper, Some(think), threads)
    }

    /// A misdeal, when the seat's 보통 bot would call one were it its turn
    /// to bid. Every level decides as 보통 does: the 고수 bot's search
    /// plays the seat whose turn it is, which this seat is not.
    fn off_turn(&self, _level: Level, seat: Seat, view: &View, legal: &[Action]) -> Option<Action> {
        let misdeal = Action::Misdeal;
        let calls = legal.contains(&misdeal) && tempered(seat).calls_misdeal(&view.rules, &view.hand);
        calls.then_some(misdeal)
    }

    fn decision(&self, view: &View, legal: &[Action]) -> Decision {
        if view.obvious(legal) {
            return Decision::Obvious;
        }
        match &view.phase {
            PhaseView::Bidding { .. } => Decision::Bid,
            PhaseView::Exchange { .. } => Decision::Plan,
            PhaseView::Play { lead: None, .. } => Decision::Lead,
            PhaseView::Play { .. } => Decision::Follow,
            PhaseView::Dealing | PhaseView::Done { .. } => Decision::Obvious,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine::{Game, Table, Viewer};
    use mighty::table::MightySettings;
    use mighty::testing;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    /// Over hands of 보통 bots, every decision gets the pace its phase
    /// calls for, and a lone legal move is always obvious.
    #[test]
    fn decisions_follow_the_phase() {
        let mut seen = Vec::new();
        for seed in 0..20 {
            let options = Mighty::hand_options(&MightySettings::default(), 0, None, 0);
            let mut rng = StdRng::seed_from_u64(seed);
            let mut bots: Vec<_> = (0..5)
                .map(|s| MightyBots.bot(Level::Normal, s, Duration::ZERO, 1))
                .collect();
            let mut choose = |state: &mighty::State, seat: usize, legal: &[Action], rng: &mut dyn rand::RngCore| {
                let view = Mighty::view(state, Viewer::Seat(seat));
                let decision = MightyBots.decision(&view, legal);
                let expected = match &view.phase {
                    _ if legal.len() == 1 => vec![Decision::Obvious],
                    PhaseView::Bidding { .. } => vec![Decision::Bid],
                    PhaseView::Exchange { .. } => vec![Decision::Plan],
                    PhaseView::Play { lead: None, .. } => vec![Decision::Lead],
                    _ => vec![Decision::Follow, Decision::Obvious],
                };
                assert!(expected.contains(&decision), "{decision:?} for {:?}", view.phase);
                seen.push(decision);
                bots[seat].act(&view, legal, rng)
            };
            testing::play_hand(&options, &mut rng, &mut choose, &mut |_, _| true);
        }
        // Both real and obvious choices come up in twenty hands.
        let follows = seen.iter().filter(|d| **d == Decision::Follow).count();
        assert!(follows > 0 && seen.contains(&Decision::Obvious));
    }

    /// Off its turn, a bot calls a misdeal exactly when its 보통 self would
    /// on its turn to bid.
    #[test]
    fn a_bot_calls_a_misdeal_off_turn_as_it_would_on_its_turn() {
        let mut calls = 0;
        for seed in 0..200 {
            let options = Mighty::hand_options(&MightySettings::default(), 0, None, 0);
            let mut rng = StdRng::seed_from_u64(seed);
            let mut state = Mighty::new_game(&options).unwrap();
            let deal = Mighty::sample_chance(&state, &mut rng);
            Mighty::apply_chance(&mut state, deal).unwrap();
            for seat in 1..5 {
                let legal = Mighty::legal_actions(&state, seat);
                let view = Mighty::view(&state, Viewer::Seat(seat));
                let off = MightyBots.off_turn(Level::Hard, seat, &view, &legal);
                let wants = legal.contains(&Action::Misdeal) && {
                    let bids = [Action::Misdeal, Action::Pass];
                    MightyBots
                        .bot(Level::Normal, seat, Duration::ZERO, 1)
                        .act(&view, &bids, &mut rng)
                        == Action::Misdeal
                };
                assert_eq!(off.is_some(), wants, "seed {seed} seat {seat}");
                calls += usize::from(wants);
            }
        }
        assert!(calls > 0, "some deal is thrown in");
    }
}
