use crate::card::Card;
use crate::rules::{Contract, Rules};
use crate::state::{Action, Bid, FriendCall, Phase, Play, Redealt, State};
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
        /// Everyone is answering whether they call a misdeal before any
        /// bid (`misdeal.ask_first`); a pass now means "no misdeal".
        #[serde(default)]
        asking_misdeal: bool,
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
                asking_misdeal: b.asking,
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
                no_friend: no_friend(state, p, me),
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
                discards: if state.rules.reveal_discards {
                    d.discards.clone()
                } else {
                    own_discards(d.declarer, &d.discards).unwrap_or_default()
                },
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
        FriendCall::FirstTrick => p.tricks.first().is_some_and(|t| t.winner == p.declarer),
        FriendCall::Card(card) => {
            let played = p.tricks.iter().flat_map(|t| &t.plays).chain(&p.plays);
            let shown = played.clone().any(|pl| pl.card == card && pl.seat == p.declarer);
            let own = me == Some(p.declarer) && (state.hands[p.declarer].contains(&card) || p.discards.contains(&card));
            shown || own
        }
        FriendCall::Seat(_) | FriendCall::LastTrick => false,
    }
}
