use crate::card::Card;
use crate::rules::{Contract, Rules};
use crate::score::HandValue;
use crate::state::{Action, Bid, FriendCall, Phase, Play, Redealt, State};
use crate::trick::{Lead, Played, Trick};
use engine::{Seat, Viewer};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

/// Everything one viewer may know. Other hands, the kitty and (for anyone
/// but the declarer) the discards are never included.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct View {
    pub viewer: Viewer,
    // Shared with the game's state: views are made often.
    pub rules: Arc<Rules>,
    pub first_bidder: Seat,
    /// Empty for spectators.
    pub hand: Vec<Card>,
    pub hand_sizes: Vec<usize>,
    /// Point cards each seat has won; they lie face up.
    pub points_taken: Vec<Vec<Card>>,
    pub phase: PhaseView,
    /// Every bid and pass of this deal so far, in order; everyone hears
    /// them. Empty while dealing.
    #[serde(default)]
    pub bids: Vec<Bid>,
    /// Why the cards were last dealt again, while the new deal is bid on.
    #[serde(default)]
    pub redealt: Option<Redealt>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum PhaseView {
    Dealing,
    Bidding {
        to_act: Seat,
        best: Option<(Seat, Contract)>,
        passed: Vec<bool>,
        /// Who has bid at least once; unless the rules say otherwise, they
        /// may no longer call a misdeal.
        has_bid: Vec<bool>,
    },
    Exchange {
        declarer: Seat,
        contract: Contract,
        trump_changed: bool,
        /// Only the declarer sees these.
        discards: Option<Vec<Card>>,
    },
    Play {
        declarer: Seat,
        contract: Contract,
        call: FriendCall,
        /// Set once the friend is publicly known.
        friend: Option<Seat>,
        /// The viewer knows there is no friend: called alone, the 주공 took
        /// the first trick that named the friend, or played the called card,
        /// or (for the 주공) the called card is in their hand or discards.
        #[serde(default)]
        no_friend: bool,
        trick_no: usize,
        leader: Seat,
        lead: Option<Lead>,
        plays: Vec<Played>,
        /// Who is winning the trick so far, worked out here so the table
        /// never has to know the rules. None before the first card.
        #[serde(default)]
        leading: Option<Seat>,
        called_joker: Option<Card>,
        /// Completed tricks, oldest first. All of it was played face up.
        tricks: Vec<Trick>,
        /// Only the declarer sees these.
        discards: Option<Vec<Card>>,
    },
    Done {
        declarer: Seat,
        contract: Contract,
        call: FriendCall,
        friend: Option<Seat>,
        team_points: u8,
        payoffs: Vec<i64>,
        /// How the hand was scored, step by step: what one opponent pays.
        value: HandValue,
        tricks: Vec<Trick>,
        /// Shown to everyone once the hand is over.
        discards: Vec<Card>,
    },
}

/// What the simple bot looks at: a seat's hand and what that seat has seen
/// of the table, borrowed from a [`View`] or straight from the game's
/// [`State`]. Playouts and reading the table ask the bot thousands of
/// times a decision; borrowing the state spares a view each time.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Seen<'a> {
    /// `None` for a spectator.
    pub me: Option<Seat>,
    pub rules: &'a Rules,
    pub hand: &'a [Card],
    pub phase: SeenPhase<'a>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum SeenPhase<'a> {
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
    },
    /// Dealing, or the hand is over: nothing to decide.
    Idle,
}

impl<'a> Seen<'a> {
    pub(crate) fn of_view(view: &'a View) -> Seen<'a> {
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
    pub(crate) fn of_state(state: &'a State, seat: Seat) -> Seen<'a> {
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

impl View {
    pub(crate) fn new(state: &State, viewer: Viewer) -> View {
        let me = match viewer {
            Viewer::Seat(s) => Some(s),
            Viewer::Spectator => None,
        };
        View {
            hand: me.map(|s| state.hands()[s].clone()).unwrap_or_default(),
            hand_sizes: state.hands().iter().map(Vec::len).collect(),
            points_taken: state
                .taken()
                .iter()
                .map(|t| t.iter().copied().filter(|c| c.is_point()).collect())
                .collect(),
            bids: state.bids().to_vec(),
            redealt: state.redealt().cloned(),
            ..View::lean(state, viewer)
        }
    }

    /// The rules and the phase as `viewer` sees them; nothing else.
    fn lean(state: &State, viewer: Viewer) -> View {
        let me = match viewer {
            Viewer::Seat(s) => Some(s),
            Viewer::Spectator => None,
        };
        let own_discards = |declarer: Seat, discards: &[Card]| (me == Some(declarer)).then(|| discards.to_vec());
        let phase = match state.phase() {
            Phase::Dealing => PhaseView::Dealing,
            Phase::Bidding(b) => PhaseView::Bidding {
                to_act: b.to_act,
                best: b.best,
                passed: b.passed.clone(),
                has_bid: b.has_bid.clone(),
            },
            Phase::Exchange(e) => PhaseView::Exchange {
                declarer: e.declared.declarer,
                contract: e.declared.contract,
                trump_changed: e.trump_changed,
                discards: own_discards(e.declared.declarer, &e.declared.discards),
            },
            Phase::Play(p) => PhaseView::Play {
                declarer: p.declared.declarer,
                contract: p.declared.contract,
                call: p.call,
                friend: p.friend,
                no_friend: no_friend(state, p, me),
                trick_no: p.trick_no,
                leader: p.leader,
                lead: p.lead,
                plays: p.plays.clone(),
                leading: state.leading(p),
                called_joker: p.called_joker,
                tricks: p.tricks.clone(),
                discards: own_discards(p.declared.declarer, &p.declared.discards),
            },
            Phase::Done(d) => PhaseView::Done {
                declarer: d.declared.declarer,
                contract: d.declared.contract,
                call: d.call,
                friend: d.friend,
                team_points: d.team_points,
                payoffs: d.payoffs.clone(),
                value: crate::score::breakdown(
                    state.rules(),
                    d.declared.contract,
                    d.call == FriendCall::Alone,
                    d.team_points,
                ),
                tricks: d.tricks.clone(),
                discards: if state.rules().reveal_discards {
                    d.declared.discards.clone()
                } else {
                    own_discards(d.declared.declarer, &d.declared.discards).unwrap_or_default()
                },
            },
        };
        View {
            viewer,
            rules: state.shared_rules().clone(),
            first_bidder: state.first_bidder(),
            hand: Vec::new(),
            hand_sizes: Vec::new(),
            points_taken: Vec::new(),
            phase,
            bids: Vec::new(),
            redealt: None,
        }
    }
}

impl View {
    /// Whether the choice among `legal` is no real choice: one action, or
    /// cards following a trick that are all alike. Alike means one suit,
    /// all point cards or none, no mighty or joker, and no card anyone
    /// could still hold ranking between them, so whichever is played the
    /// trick and the hand go the same way.
    pub fn obvious(&self, legal: &[Action]) -> bool {
        if legal.len() <= 1 {
            return true;
        }
        let PhaseView::Play {
            contract,
            lead: Some(_),
            plays,
            tricks,
            ..
        } = &self.phase
        else {
            return false;
        };
        let mighty = self.rules.mighty(contract.trump);
        let mut cards = Vec::with_capacity(legal.len());
        for a in legal {
            match a {
                Action::Play {
                    card,
                    joker_lead: None,
                    call_joker: false,
                } if !card.is_joker() && *card != mighty => cards.push(*card),
                _ => return false,
            }
        }
        let first = cards[0];
        if cards
            .iter()
            .any(|c| c.suit() != first.suit() || c.is_point() != first.is_point())
        {
            return false;
        }
        let (Some(suit), Some(low), Some(high)) = (
            first.suit(),
            cards.iter().filter_map(|c| c.rank()).min(),
            cards.iter().filter_map(|c| c.rank()).max(),
        ) else {
            return false;
        };
        let played = |card: Card| {
            tricks
                .iter()
                .flat_map(|t| &t.plays)
                .chain(plays)
                .any(|p| p.card == card)
        };
        (low + 1..high).all(|rank| {
            let card = Card::new(suit, rank);
            self.hand.contains(&card) || played(card)
        })
    }
}

/// Whether `me` can tell the 주공 has no friend, as far as what they have
/// seen allows: everyone once it shows at the table, the 주공 at once when
/// they named a card of their own.
fn no_friend(state: &State, p: &Play, me: Option<Seat>) -> bool {
    match p.call {
        FriendCall::Alone => true,
        FriendCall::FirstTrick => p.tricks.first().is_some_and(|t| t.winner == p.declared.declarer),
        FriendCall::Card(card) => {
            let played = p.tricks.iter().flat_map(|t| &t.plays).chain(&p.plays);
            let shown = played
                .clone()
                .any(|pl| pl.card == card && pl.seat == p.declared.declarer);
            let own = me == Some(p.declared.declarer)
                && (state.hands()[p.declared.declarer].contains(&card) || p.declared.discards.contains(&card));
            shown || own
        }
        FriendCall::Seat(_) | FriendCall::LastTrick => false,
    }
}
