//! Hands played by one table of bots and recorded, to replay.

use crate::error::{LabError, Result};
use crate::stream::{Stream, streams};
use crate::table::{Actor, Phase, Table, advance};
use engine::{Game, Seat, Viewer};
use mighty::card::Suit;
use mighty::rules::{Contract, Rules};
use mighty::{Action, FriendCall, Mighty, Options, PhaseView, State, View};
use mighty_ai::SimpleBot;
use serde::{Deserialize, Serialize};

/// A bid or pass, with what the simple bot thought of the hand.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidDecision {
    pub index: usize,
    pub seat: Seat,
    pub action: Action,
    /// The simple bot's best trump and its estimate of the hand there.
    pub trump: Option<Suit>,
    pub estimate: f32,
    /// The cheapest legal bid in that trump, if any.
    pub cheapest: Option<u8>,
}

/// One hand played by a table of bots, to replay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Record {
    pub deal: u64,
    pub first_bidder: Seat,
    pub log: Vec<Action>,
    /// Where the exchange and the card play begin in `log`.
    pub exchange_at: usize,
    pub play_at: usize,
    pub bids: Vec<BidDecision>,
    pub declarer: Seat,
    pub contract: Contract,
    pub call: FriendCall,
    pub friend: Option<Seat>,
    pub team_points: u8,
    pub payoffs: Vec<i64>,
}

impl Record {
    /// Whether `seat` was on the declarer's side.
    pub fn attacking(&self, seat: Seat) -> bool {
        seat == self.declarer || self.friend == Some(seat)
    }
}

/// The options of hand `deal`: the first bidder turns with the deal.
pub fn options(rules: &Rules, deal: u64) -> Options {
    Options {
        rules: rules.clone(),
        first_bidder: (deal % rules.players as u64) as usize,
    }
}

/// A new hand `deal` under `rules`.
pub fn new_hand(rules: &Rules, deal: u64) -> Result<State> {
    Mighty::new_game(&options(rules, deal)).map_err(|e| LabError::Rules(e.to_string()))
}

/// The best trump by the simple bot's estimate, the estimate, and the
/// cheapest legal bid in it.
pub fn simple_read(view: &View, legal: &[Action]) -> (Option<Suit>, f32, Option<u8>) {
    let bot = SimpleBot::default();
    let (trump, estimate) = Suit::ALL
        .into_iter()
        .map(|s| (Some(s), bot.estimate(&view.rules, &view.hand, Some(s))))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .expect("four suits");
    let cheapest = legal
        .iter()
        .filter_map(|a| match a {
            Action::Bid(c) if c.trump == trump => Some(c.count),
            _ => None,
        })
        .min();
    (trump, estimate, cheapest)
}

/// Plays hand `deal` with `bot` in every seat, recording it.
pub fn generate(rules: &Rules, deal: u64, bot: &Actor) -> Result<Record> {
    let seats = rules.players;
    let first_bidder = options(rules, deal).first_bidder;
    let mut state = new_hand(rules, deal)?;
    let table = Table::of(bot);
    let mut log = Vec::new();
    let mut bids = Vec::new();
    let mut rngs = streams(deal, Stream::Bid, seats);
    advance(
        deal,
        &mut state,
        &table,
        &mut rngs,
        &mut log,
        Phase::Bidding,
        &mut |d| {
            let view = Mighty::view(d.state, Viewer::Seat(d.seat));
            let legal = Mighty::legal_actions(d.state);
            let (trump, estimate, cheapest) = simple_read(&view, &legal);
            bids.push(BidDecision {
                index: d.index,
                seat: d.seat,
                action: d.action.clone(),
                trump,
                estimate,
                cheapest,
            });
        },
    )?;
    let exchange_at = log.len();
    let mut rngs = streams(deal, Stream::Exchange, seats);
    advance(
        deal,
        &mut state,
        &table,
        &mut rngs,
        &mut log,
        Phase::Exchange,
        &mut |_| {},
    )?;
    let play_at = log.len();
    let mut rngs = streams(deal, Stream::Play, seats);
    advance(deal, &mut state, &table, &mut rngs, &mut log, Phase::Play, &mut |_| {})?;
    // Redeals restart the bidding; only the last deal's bids count.
    let last_deal = log.iter().rposition(|a| matches!(a, Action::Deal { .. })).unwrap_or(0);
    bids.retain(|b| b.index > last_deal);
    let done = outcome(deal, &state)?;
    let PhaseView::Done { call, .. } = Mighty::view(&state, Viewer::Spectator).phase else {
        unreachable!("the outcome is read from a finished hand")
    };
    Ok(Record {
        deal,
        first_bidder,
        log,
        exchange_at,
        play_at,
        bids,
        declarer: done.declarer,
        contract: done.contract,
        call,
        friend: done.friend,
        team_points: done.team_points,
        payoffs: done.payoffs,
    })
}

/// The state after the first `upto` actions of `record`.
pub fn replay(rules: &Rules, record: &Record, upto: usize) -> Result<State> {
    let mut state = new_hand(rules, record.deal)?;
    for (step, action) in record.log[..upto.min(record.log.len())].iter().enumerate() {
        Mighty::apply(&mut state, action.clone()).map_err(|e| LabError::Replay {
            deal: record.deal,
            step,
            action: action.clone(),
            why: e.to_string(),
        })?;
    }
    Ok(state)
}

/// Applies an action an experiment chose.
pub fn apply(deal: u64, state: &mut State, action: Action) -> Result<()> {
    Mighty::apply(state, action.clone()).map_err(|e| LabError::Refused {
        deal,
        action,
        why: e.to_string(),
    })
}

/// The outcome of a hand played on from some point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Outcome {
    pub payoffs: Vec<i64>,
    pub declarer: Seat,
    #[serde(default)]
    pub friend: Option<Seat>,
    pub contract: Contract,
    pub team_points: u8,
}

/// How hand `deal`, now over in `state`, ended.
pub fn outcome(deal: u64, state: &State) -> Result<Outcome> {
    let PhaseView::Done {
        declarer,
        contract,
        friend,
        team_points,
        payoffs,
        ..
    } = Mighty::view(state, Viewer::Spectator).phase
    else {
        return Err(LabError::Hand {
            deal,
            what: "the hand did not end".into(),
        });
    };
    Ok(Outcome {
        payoffs,
        declarer,
        friend,
        contract,
        team_points,
    })
}
