//! The bidding of a recorded hand, decided otherwise: the declarer passing
//! instead of its winning bid, the closest pass bidding instead, and what
//! playouts thought of both.

use crate::error::Result;
use crate::record::{Outcome, Record, apply, outcome, replay};
use crate::stream::{LabUse, Stream, lab, streams};
use crate::table::{Actor, Phase, Table, advance, phase};
use engine::{Game, Seat, Viewer};
use mighty::rules::{Contract, Rules};
use mighty::{Action, Mighty, State};
use mighty_ai::SearchBot;
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};

/// What the simple-bot playouts think a hand is worth as declarer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Oracle {
    /// Weighted mean of the declarer's side's points, and the weighted
    /// share of deals ending with each total, 0 to 20.
    pub mean_points: f64,
    pub points: Vec<f64>,
}

/// From the bidding view of `seat` in `state`, as if `seat` bid `contract`
/// and everyone else passed: the declarer's side's points over sampled
/// deals, with simple bots exchanging and playing.
pub fn bid_oracle(state: &State, seat: Seat, contract: Contract, worlds: usize, rng: &mut ChaCha8Rng) -> Oracle {
    let view = Mighty::view(state, Viewer::Seat(seat));
    let search = SearchBot::default();
    let simple = Actor::simple();
    let mut points = Vec::new();
    for (world, weight) in search.worlds(&view, worlds, rng) {
        let mut s = world;
        if engine::apply_on_turn::<Mighty>(&mut s, Action::Bid(contract)).is_err() {
            continue;
        }
        while phase(&s) == Phase::Bidding {
            if engine::apply_on_turn::<Mighty>(&mut s, Action::Pass).is_err() {
                break;
            }
        }
        let seats = Mighty::seat_count(&s);
        let mut rngs: Vec<ChaCha8Rng> = (0..=seats).map(|t| lab(0, LabUse::OracleTable(t))).collect();
        // A world the playouts cannot finish says nothing.
        let played = advance(
            0,
            &mut s,
            &Table::of(&simple),
            &mut rngs,
            &mut Vec::new(),
            Phase::Play,
            &mut |_| {},
        );
        if played.is_ok()
            && let Ok(done) = outcome(0, &s)
        {
            points.push((f64::from(done.team_points), weight));
        }
    }
    let total: f64 = points.iter().map(|p| p.1).sum::<f64>().max(1e-12);
    let mean_points = points.iter().map(|(p, w)| p * w).sum::<f64>() / total;
    let mut histogram = vec![0.0; 21];
    for (p, w) in &points {
        histogram[(*p as usize).min(20)] += w / total;
    }
    Oracle {
        mean_points,
        points: histogram,
    }
}

/// Bidding experiments on one recorded hand.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidResult {
    pub deal: u64,
    pub declarer: Seat,
    pub contract: Contract,
    pub team_points: u8,
    pub declarer_payoff: i64,
    /// The declarer's payoff had it passed instead of its winning bid.
    pub pass_instead: Option<i64>,
    /// What the playouts thought of the winning bid when it was made.
    pub oracle: Option<Oracle>,
    /// The closest pass: a seat that passed with the simple bot's
    /// estimate nearest the cheapest bid, what it would have bid, its
    /// estimate, and its payoff passing and bidding.
    pub close_pass: Option<ClosePass>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClosePass {
    pub seat: Seat,
    pub bid: Contract,
    pub estimate: f32,
    pub passed: i64,
    pub bidding: i64,
    pub bidding_contract: Contract,
    pub bidding_team_points: u8,
    pub bidding_declarer: Seat,
    pub oracle: Oracle,
}

/// Replays `record` up to step `at`, takes `action` there instead, and
/// plays the hand on with `bot` in every seat.
fn play_on(rules: &Rules, record: &Record, at: usize, action: Action, bot: &Actor) -> Result<Outcome> {
    let mut state = replay(rules, record, at)?;
    apply(record.deal, &mut state, action)?;
    let mut rngs = streams(record.deal, Stream::AfterBid, rules.players);
    advance(
        record.deal,
        &mut state,
        &Table::of(bot),
        &mut rngs,
        &mut Vec::new(),
        Phase::Play,
        &mut |_| {},
    )?;
    outcome(record.deal, &state)
}

pub fn bid_experiment(rules: &Rules, record: &Record, bot: &Actor, worlds: usize) -> Result<BidResult> {
    let mut lab_rng = lab(record.deal, LabUse::BidOracle);
    let winning = record
        .bids
        .iter()
        .rev()
        .find(|b| b.seat == record.declarer && matches!(b.action, Action::Bid(_)));
    let (pass_instead, oracle) = match winning {
        Some(b) => {
            let state = replay(rules, record, b.index)?;
            let pass = if engine::legal_on_turn::<Mighty>(&state).contains(&Action::Pass) {
                Some(play_on(rules, record, b.index, Action::Pass, bot)?.payoffs[b.seat])
            } else {
                None
            };
            let Action::Bid(c) = b.action else {
                unreachable!("found as a bid")
            };
            (pass, Some(bid_oracle(&state, b.seat, c, worlds, &mut lab_rng)))
        }
        None => (None, None),
    };
    let close = record
        .bids
        .iter()
        .filter(|b| b.action == Action::Pass)
        .filter_map(|b| Some((b, f32::from(b.cheapest?) - b.estimate)))
        .filter(|(_, gap)| *gap <= 1.5)
        .min_by(|a, b| a.1.total_cmp(&b.1));
    let close_pass = match close {
        Some((b, _)) => {
            let bid = Contract {
                trump: b.trump,
                count: b.cheapest.expect("filtered"),
            };
            let state = replay(rules, record, b.index)?;
            let oracle = bid_oracle(&state, b.seat, bid, worlds, &mut lab_rng);
            let done = play_on(rules, record, b.index, Action::Bid(bid), bot)?;
            Some(ClosePass {
                seat: b.seat,
                bid,
                estimate: b.estimate,
                passed: record.payoffs[b.seat],
                bidding: done.payoffs[b.seat],
                bidding_contract: done.contract,
                bidding_team_points: done.team_points,
                bidding_declarer: done.declarer,
                oracle,
            })
        }
        None => None,
    };
    Ok(BidResult {
        deal: record.deal,
        declarer: record.declarer,
        contract: record.contract,
        team_points: record.team_points,
        declarer_payoff: record.payoffs[record.declarer],
        pass_instead,
        oracle,
        close_pass,
    })
}
