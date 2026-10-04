use crate::card::Card;
use crate::rules::{Contract, Rules};
use crate::state::{Bid, FriendCall, Phase, Redealt, State};
use crate::trick::{Lead, Played, Trick};
use engine::{Seat, Viewer};
use serde::{Deserialize, Serialize};

/// Everything one viewer may know. Other hands, the kitty and (for anyone
/// but the declarer) the discards are never included.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct View {
    pub viewer: Viewer,
    pub rules: Rules,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PhaseView {
    Dealing,
    Bidding {
        to_act: Seat,
        best: Option<(Seat, Contract)>,
        passed: Vec<bool>,
        /// Who has bid at least once; they may no longer call a misdeal.
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
        tricks: Vec<Trick>,
        /// Shown to everyone once the hand is over.
        discards: Vec<Card>,
    },
}

impl View {
    /// The view of `seat`, without what the simple bot never looks at
    /// (hand sizes, points taken, the bidding): playouts and reading build
    /// one for every card played, so it should cost little.
    pub(crate) fn for_policy(state: &State, seat: Seat) -> View {
        let mut view = View::lean(state, Viewer::Seat(seat));
        view.hand = state.hands[seat].clone();
        view
    }

    pub(crate) fn new(state: &State, viewer: Viewer) -> View {
        let me = match viewer {
            Viewer::Seat(s) => Some(s),
            Viewer::Spectator => None,
        };
        View {
            hand: me.map(|s| state.hands[s].clone()).unwrap_or_default(),
            hand_sizes: state.hands.iter().map(Vec::len).collect(),
            points_taken: state
                .taken
                .iter()
                .map(|t| t.iter().copied().filter(|c| c.is_point()).collect())
                .collect(),
            bids: state.bids.clone(),
            redealt: state.redealt.clone(),
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
        let phase = match &state.phase {
            Phase::Dealing => PhaseView::Dealing,
            Phase::Bidding(b) => PhaseView::Bidding {
                to_act: b.to_act,
                best: b.best,
                passed: b.passed.clone(),
                has_bid: b.has_bid.clone(),
            },
            Phase::Exchange(e) => PhaseView::Exchange {
                declarer: e.declarer,
                contract: e.contract,
                trump_changed: e.trump_changed,
                discards: own_discards(e.declarer, &e.discards),
            },
            Phase::Play(p) => PhaseView::Play {
                declarer: p.declarer,
                contract: p.contract,
                call: p.call,
                friend: p.friend,
                trick_no: p.trick_no,
                leader: p.leader,
                lead: p.lead,
                plays: p.plays.clone(),
                leading: state.leading(p),
                called_joker: p.called_joker,
                tricks: p.tricks.clone(),
                discards: own_discards(p.declarer, &p.discards),
            },
            Phase::Done(d) => PhaseView::Done {
                declarer: d.declarer,
                contract: d.contract,
                call: d.call,
                friend: d.friend,
                team_points: d.team_points,
                payoffs: d.payoffs.clone(),
                tricks: d.tricks.clone(),
                discards: d.discards.clone(),
            },
        };
        View {
            viewer,
            rules: state.rules.clone(),
            first_bidder: state.first_bidder,
            hand: Vec::new(),
            hand_sizes: Vec::new(),
            points_taken: Vec::new(),
            phase,
            bids: Vec::new(),
            redealt: None,
        }
    }
}
