//! What the simple bot decides on.

use engine::{Seat, Viewer};
use mighty::card::Card;
use mighty::rules::{Contract, Rules};
use mighty::trick::{Lead, Played, Trick};
use mighty::world::Phase;
use mighty::{FriendCall, PhaseView, State, View};

/// What the simple bot looks at: a seat's hand and what that seat has seen
/// of the table, borrowed from a [`View`] or straight from the game's
/// [`State`]. Playouts and reading the table ask the bot thousands of
/// times a decision; borrowing the state spares a view each time.
#[derive(Debug, Clone, Copy)]
pub struct Seen<'a> {
    /// `None` for a spectator.
    pub me: Option<Seat>,
    pub rules: &'a Rules,
    pub hand: &'a [Card],
    pub phase: SeenPhase<'a>,
}

#[derive(Debug, Clone, Copy)]
pub enum SeenPhase<'a> {
    Bidding,
    Exchange {
        contract: Contract,
        /// The declarer's own discards so far; empty for anyone else.
        discards: &'a [Card],
    },
    Play {
        declarer: Seat,
        contract: Contract,
        call: FriendCall,
        friend: Option<Seat>,
        trick_no: usize,
        lead: Option<Lead>,
        plays: &'a [Played],
        called_joker: Option<Card>,
        tricks: &'a [Trick],
        /// The declarer's own discards, to the declarer; `None` to anyone
        /// else.
        discards: Option<&'a [Card]>,
    },
    /// Dealing, or the hand is over: nothing to decide.
    Idle,
}

impl<'a> Seen<'a> {
    pub fn of_view(view: &'a View) -> Seen<'a> {
        let phase = match &view.phase {
            PhaseView::Bidding { .. } => SeenPhase::Bidding,
            PhaseView::Exchange { contract, discards, .. } => SeenPhase::Exchange {
                contract: *contract,
                discards: discards.as_deref().unwrap_or_default(),
            },
            PhaseView::Play {
                declarer,
                contract,
                call,
                friend,
                trick_no,
                lead,
                plays,
                called_joker,
                tricks,
                discards,
                ..
            } => SeenPhase::Play {
                declarer: *declarer,
                contract: *contract,
                call: *call,
                friend: *friend,
                trick_no: *trick_no,
                lead: *lead,
                plays,
                called_joker: *called_joker,
                tricks,
                discards: discards.as_deref(),
            },
            PhaseView::Dealing | PhaseView::Done { .. } => SeenPhase::Idle,
        };
        Seen {
            me: match view.viewer {
                Viewer::Seat(s) => Some(s),
                Viewer::Spectator => None,
            },
            rules: &view.rules,
            hand: &view.hand,
            phase,
        }
    }

    /// What `seat` sees of `state`: as [`Seen::of_view`] of its view.
    pub fn of_state(state: &'a State, seat: Seat) -> Seen<'a> {
        let own = |declarer: Seat, discards: &'a [Card]| (declarer == seat).then_some(discards);
        let phase = match state.phase() {
            Phase::Bidding(_) => SeenPhase::Bidding,
            Phase::Exchange(e) => SeenPhase::Exchange {
                contract: e.declared.contract,
                discards: own(e.declared.declarer, &e.declared.discards).unwrap_or_default(),
            },
            Phase::Play(p) => SeenPhase::Play {
                declarer: p.declared.declarer,
                contract: p.declared.contract,
                call: p.call,
                friend: p.friend,
                trick_no: p.trick_no,
                lead: p.lead,
                plays: &p.plays,
                called_joker: p.called_joker,
                tricks: &p.tricks,
                discards: own(p.declared.declarer, &p.declared.discards),
            },
            Phase::Dealing | Phase::Done(_) => SeenPhase::Idle,
        };
        Seen {
            me: Some(seat),
            rules: state.rules(),
            hand: &state.hands()[seat],
            phase,
        }
    }
}
