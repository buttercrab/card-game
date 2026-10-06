//! How much of a hand's payoff can be told at bidding time: every
//! bidding decision of a hand (bids, passes, misdeals), with the payoff
//! that seat got for the hand, next to what three predictors made of it
//! when it was taken:
//!
//! - the simple bot's reading of the hand (its estimate in its best trump,
//!   what the cheapest bid there needs, where the bidding stands);
//! - a Q network's values for the legal actions, if given;
//! - 고수's search value: deals the seat cannot tell from the real one,
//!   each action played out by simple bots in every seat, on a sample of
//!   decisions (it costs a few hundred playouts each).
//!
//! The payoff is the hand's, as self-play DMC labels the decision; a
//! decision in a deal later thrown in (a misdeal, or everyone passing) is
//! marked, since its payoff then comes from other cards.

use crate::error::{LabError, Result};
use crate::record::{new_hand, options, outcome};
use crate::stream::{LabUse, Stream, lab, streams};
use crate::table::{Actor, Phase, Table, advance};
use engine::{Game, Seat, Viewer};
use engine_ml::{ActionValues, Encode};
use mighty::rules::Rules;
use mighty::{Action, Mighty, PhaseView, State};
use mighty_ai::SimpleBot;
use mighty_ai::{SearchBot, play_out};

use serde::{Deserialize, Serialize};

/// One bidding decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalRow {
    pub deal: u64,
    pub seat: Seat,
    /// Seats after the first bidder.
    pub position: usize,
    /// The deal of the hand it was taken in (0 the first); `thrown_in`
    /// when a later deal was the one played.
    pub deal_no: usize,
    pub thrown_in: bool,
    /// "bid", "pass" or "misdeal", and the bid's count (0 otherwise).
    pub kind: String,
    pub count: u8,
    pub no_trump: bool,
    /// The bids and passes so far in this deal, and the best bid's count
    /// (0 none).
    pub bids_before: usize,
    pub best_count: u8,
    /// The simple bot's estimate of the hand in its best trump, and what
    /// the cheapest legal bid in that trump needs (none if no bid).
    pub estimate: f32,
    pub needed: Option<f32>,
    /// The seat's payoff for the hand.
    pub payoff: i64,
    /// Was the seat the declarer, the friend, in the hand played?
    pub declarer: bool,
    pub friend: bool,
    /// The network's values, in points: the action taken, the best legal
    /// action, passing, the best bid.
    pub q_chosen: Option<f32>,
    pub q_max: Option<f32>,
    pub q_pass: Option<f32>,
    pub q_best_bid: Option<f32>,
    /// The search's values (mean payoff over sampled deals, simple-bot
    /// playouts): the action taken, passing, the simple bot's cheapest bid
    /// in its best trump.
    pub s_chosen: Option<f64>,
    pub s_pass: Option<f64>,
    pub s_simple_bid: Option<f64>,
}

/// The settings of [`bid_signal`].
#[derive(Clone, Copy)]
pub struct SignalSetup<'a> {
    pub bot: &'a Actor,
    pub net: Option<&'a dyn ActionValues>,
    /// Deals per search value; 0 runs no search.
    pub worlds: usize,
    /// Search one decision in this many (by deal and index).
    pub search_every: usize,
}

/// Plays hand `deal` with `setup.bot` in every seat and returns its
/// bidding decisions.
pub fn bid_signal(rules: &Rules, deal: u64, setup: SignalSetup) -> Result<Vec<SignalRow>> {
    let seats = rules.players;
    let opts = options(rules, deal);
    let mut state = new_hand(rules, deal)?;
    let mut log = Vec::new();
    let mut taken: Vec<(State, Seat, Action, usize)> = Vec::new();
    let table = Table {
        all: setup.bot,
        focus: None,
    };
    for (phase, part) in [
        (Phase::Bidding, Stream::Bid),
        (Phase::Exchange, Stream::Exchange),
        (Phase::Play, Stream::Play),
    ] {
        let mut rngs = streams(deal, part, seats);
        advance(deal, &mut state, &table, &mut rngs, &mut log, phase, &mut |d| {
            if matches!(
                Mighty::view(d.state, Viewer::Spectator).phase,
                PhaseView::Bidding { .. }
            ) {
                taken.push((d.state.clone(), d.seat, d.action.clone(), d.index));
            }
        })?;
    }
    let done = outcome(deal, &state)?;
    let (declarer, friend, payoffs) = (done.declarer, done.friend, done.payoffs);
    // Where each deal starts in the log: a decision's deal is the last
    // one before it.
    let dealt: Vec<usize> = (0..log.len())
        .filter(|&i| matches!(log[i], Action::Deal { .. }))
        .collect();
    let last = dealt.len().saturating_sub(1);
    let simple = SimpleBot::default();
    taken
        .into_iter()
        .enumerate()
        .map(|(i, (before, seat, action, at))| -> Result<SignalRow> {
            let deal_no = dealt.iter().filter(|&&d| d < at).count().saturating_sub(1);
            let view = Mighty::view(&before, Viewer::Seat(seat));
            let legal = engine::legal_on_turn::<Mighty>(&before);
            let PhaseView::Bidding { best, .. } = &view.phase else {
                unreachable!("kept bidding decisions")
            };
            let estimate = |t| simple.estimate(&view.rules, &view.hand, t);
            let trump = mighty::card::Suit::ALL
                .into_iter()
                .map(Some)
                .max_by(|&a, &b| estimate(a).total_cmp(&estimate(b)))
                .expect("four suits");
            let cheapest = legal
                .iter()
                .filter_map(|a| match a {
                    Action::Bid(c) if c.trump == trump => Some(*c),
                    _ => None,
                })
                .min_by_key(|c| c.count);
            let (kind, count, no_trump) = match &action {
                Action::Bid(c) => ("bid", c.count, c.trump.is_none()),
                Action::Pass => ("pass", 0, false),
                Action::Misdeal => ("misdeal", 0, false),
                other => unreachable!("{other:?} while bidding"),
            };
            let mut row = SignalRow {
                deal,
                seat,
                position: (seat + seats - opts.first_bidder) % seats,
                deal_no,
                thrown_in: deal_no < last,
                kind: kind.into(),
                count,
                no_trump,
                bids_before: view.bids.len(),
                best_count: best.map_or(0, |(_, c)| c.count),
                estimate: estimate(trump),
                needed: cheapest.map(|c| simple.needed(&view.rules, c)),
                payoff: payoffs[seat],
                declarer: declarer == seat && deal_no == last,
                friend: friend == Some(seat) && deal_no == last,
                q_chosen: None,
                q_max: None,
                q_pass: None,
                q_best_bid: None,
                s_chosen: None,
                s_pass: None,
                s_simple_bid: None,
            };
            if let Some(net) = setup.net {
                let obs = Mighty::encode(&view, &legal);
                let values = net.action_values(&[&obs]).map_err(|e| LabError::Hand {
                    deal,
                    what: format!("the network failed: {e}"),
                })?;
                let value = |a: &Action| {
                    let index = Mighty::action_index(&view, a)?;
                    values[0].iter().find(|(j, _)| *j == index).map(|(_, v)| *v)
                };
                row.q_chosen = value(&action);
                row.q_max = values[0].iter().map(|(_, v)| *v).reduce(f32::max);
                row.q_pass = value(&Action::Pass);
                row.q_best_bid = legal
                    .iter()
                    .filter(|a| matches!(a, Action::Bid(_)))
                    .filter_map(value)
                    .reduce(f32::max);
            }
            let searched = setup.worlds > 0 && (deal as usize + i).is_multiple_of(setup.search_every.max(1));
            if searched && legal.len() > 1 {
                let mut rng = lab(deal, LabUse::Signal(i));
                let worlds = SearchBot::default().worlds(&view, setup.worlds, &mut rng);
                let value = |a: &Action| -> Option<f64> {
                    if !legal.contains(a) || worlds.is_empty() {
                        return None;
                    }
                    let mut total = 0.0;
                    for (world, weight) in &worlds {
                        let mut s = world.clone();
                        engine::apply_on_turn::<Mighty>(&mut s, a.clone()).ok()?;
                        total += weight * play_out(simple, 0, s, seat) as f64;
                    }
                    Some(total)
                };
                row.s_chosen = value(&action);
                row.s_pass = value(&Action::Pass);
                row.s_simple_bid = cheapest.and_then(|c| value(&Action::Bid(c)));
            }
            Ok(row)
        })
        .collect()
}
