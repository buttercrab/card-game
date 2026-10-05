use crate::card::{Card, CardSet, Color, Suit};
use crate::rules::{CardPolicy, Contract, InvalidRules, Rules, WinScore};
use crate::trick::{self, Lead, Played, Trick};
use crate::view::{PhaseView, View};
use engine::{Seat, Turn, Viewer};
use rand::RngCore;
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Options {
    pub rules: Rules,
    /// Usually the seat after the dealer.
    pub first_bidder: Seat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum FriendCall {
    Card(Card),
    Seat(Seat),
    FirstTrick,
    LastTrick,
    Alone,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum Action {
    /// Chance: the shuffled deal.
    Deal {
        hands: Vec<Vec<Card>>,
        kitty: Vec<Card>,
    },
    /// Ask for a redeal with a weak hand.
    Misdeal,
    Bid(Contract),
    Pass,
    /// Declarer, before discarding: change trump at the cost of a higher contract.
    ChangeTrump(Option<Suit>),
    /// Declarer, before discarding, where `bidding.raise_on_exchange`
    /// allows: set a higher contract than keeping trump or `ChangeTrump`
    /// gives.
    Raise(Contract),
    /// Declarer: put one card back, until as many as the kitty held.
    Discard(Card),
    CallFriend(FriendCall),
    /// `joker_lead` is what to follow when leading a joker: a suit, or its
    /// colour where the rules allow. `call_joker` calls the joker when
    /// leading its joker-call card.
    Play {
        card: Card,
        joker_lead: Option<Lead>,
        call_joker: bool,
    },
}

impl Action {
    /// The card a play puts down; `None` for any other action.
    pub fn played_card(&self) -> Option<Card> {
        match self {
            Action::Play { card, .. } => Some(*card),
            _ => None,
        }
    }
}

/// One turn of the bidding, as everyone at the table heard it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub struct Bid {
    pub seat: Seat,
    /// `None` is a pass.
    pub contract: Option<Contract>,
}

/// Why the last deal was thrown in and the cards dealt again.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum Redeal {
    /// A player showed a weak hand (딜미스); everyone sees it.
    Misdeal { seat: Seat, hand: Vec<Card> },
    /// Everyone passed.
    AllPassed,
}

/// The last redeal of this hand, and how many there have been, so two in a
/// row are told apart.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub struct Redealt {
    pub why: Redeal,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Rules(#[from] InvalidRules),
    #[error("first bidder {0} is not a seat")]
    NoSuchSeat(Seat),
    #[error("the game is over")]
    Over,
    #[error("illegal action {0:?}")]
    Illegal(Action),
    #[error("bad deal: {0}")]
    BadDeal(&'static str),
}

/// A hand of Mighty under way. Only the game's own transitions
/// ([`State::step`] and the constructors here) change it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    /// Shared with every view of the hand and every world a search deals.
    rules: Arc<Rules>,
    first_bidder: Seat,
    phase: Phase,
    /// Kept sorted.
    hands: Vec<Vec<Card>>,
    kitty: Vec<Card>,
    /// Every card each seat won in tricks.
    taken: Vec<Vec<Card>>,
    /// Every bid and pass of this deal, in order.
    bids: Vec<Bid>,
    /// Why the cards were last dealt again, until the bidding ends.
    redealt: Option<Redealt>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Phase {
    Dealing,
    Bidding(Bidding),
    Exchange(Exchange),
    Play(Play),
    Done(Done),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Bidding {
    pub to_act: Seat,
    pub best: Option<(Seat, Contract)>,
    pub passed: Vec<bool>,
    pub has_bid: Vec<bool>,
}

/// What the bidding settled and the exchange added to: every phase after
/// the bidding carries it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Declared {
    pub declarer: Seat,
    pub contract: Contract,
    /// The cards the declarer has put back; as many as the kitty held once
    /// the exchange is over.
    pub discards: Vec<Card>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Exchange {
    pub declared: Declared,
    pub trump_changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Play {
    pub declared: Declared,
    pub call: FriendCall,
    /// Set once the friend is publicly known.
    pub friend: Option<Seat>,
    pub trick_no: usize,
    pub leader: Seat,
    pub lead: Option<Lead>,
    pub plays: Vec<Played>,
    /// The joker called this trick, if the call has effect.
    pub called_joker: Option<Card>,
    /// Completed tricks, oldest first.
    pub tricks: Vec<Trick>,
}

impl Play {
    pub(crate) fn trick(&self) -> TrickState {
        TrickState {
            trump: self.declared.contract.trump,
            trick_no: self.trick_no,
            lead: self.lead,
            called_joker: self.called_joker,
        }
    }
}

/// What the cards that may be played next depend on, besides the hand: the
/// trick so far. The game ([`State::step`]) and the endgame solver, which
/// plays tricks out without a [`State`], move it on alike.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TrickState {
    pub trump: Option<Suit>,
    pub trick_no: usize,
    /// What the trick follows; `None` before its first card.
    pub lead: Option<Lead>,
    /// The joker called this trick, if the call has effect.
    pub called_joker: Option<Card>,
}

impl TrickState {
    /// The trick once `card` leads it: what it follows, and the joker it
    /// calls when `call_joker` asks and a call is possible. `gone` tells
    /// whether a joker was won in a finished trick.
    pub(crate) fn led(
        self,
        rules: &Rules,
        card: Card,
        joker_lead: Option<Lead>,
        call_joker: bool,
        gone: impl Fn(Card) -> bool,
    ) -> TrickState {
        let mut t = self;
        t.lead = if card.is_joker() {
            joker_lead
        } else {
            card.suit().map(Lead::Suit)
        };
        t.called_joker = if call_joker {
            callable_joker(rules, t, card, gone)
        } else {
            None
        };
        t
    }

    /// `card`, from `seat`, as it lies in this trick.
    pub(crate) fn played(self, rules: &Rules, seat: Seat, card: Card) -> Played {
        Played {
            seat,
            card,
            powered: powered(rules, self, card),
        }
    }

    /// The index into `plays`, this trick's cards so far, of the card
    /// winning it; `None` before the first card.
    pub(crate) fn winner(self, rules: &Rules, plays: &[Played]) -> Option<usize> {
        let lead = self.lead.filter(|_| !plays.is_empty())?;
        Some(trick::winner(&rules.trick_context(self.trump, lead), plays))
    }

    /// The next trick, before its first card.
    pub(crate) fn next(self) -> TrickState {
        TrickState {
            trump: self.trump,
            trick_no: self.trick_no + 1,
            lead: None,
            called_joker: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Done {
    pub declared: Declared,
    pub call: FriendCall,
    pub friend: Option<Seat>,
    pub team_points: u8,
    pub payoffs: Vec<i64>,
    pub tricks: Vec<Trick>,
}

/// A finished hand in brief, for the session's story.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HandSummary {
    pub contract: Contract,
    pub declarer: Seat,
    pub friend: Option<Seat>,
    pub made: bool,
    pub team_points: u8,
    /// The point cards each trick took, oldest first: positive when the
    /// declarer's side won the trick, negative for the defence, 0 for none.
    /// Points in the discards count in `team_points` only.
    pub rounds: Vec<i8>,
    /// The trick during which the friend became known; 0 for a friend
    /// called by seat, who is known from the start.
    pub friend_revealed: Option<usize>,
}

impl State {
    pub(crate) fn new(options: &Options) -> Result<State, Error> {
        options.rules.validate()?;
        let rules = Arc::new(options.rules.clone());
        if options.first_bidder >= rules.players {
            return Err(Error::NoSuchSeat(options.first_bidder));
        }
        let n = rules.players;
        Ok(State {
            rules,
            first_bidder: options.first_bidder,
            phase: Phase::Dealing,
            hands: vec![Vec::new(); n],
            kitty: Vec::new(),
            taken: vec![Vec::new(); n],
            bids: Vec::new(),
            redealt: None,
        })
    }

    /// A world `view` cannot tell from the real one but for the cards it
    /// has not seen: every other hand empty, nothing face down (fill them
    /// with [`State::fill_hidden`]), and the cards won in tricks as they
    /// were won. While bidding, exchanging and playing; `None` otherwise
    /// and for spectators.
    pub(crate) fn from_public(view: &View) -> Option<State> {
        let Viewer::Seat(_) = view.viewer else { return None };
        let seats = view.rules.players;
        let mut taken = vec![Vec::new(); seats];
        let phase = match &view.phase {
            PhaseView::Bidding {
                to_act,
                best,
                passed,
                has_bid,
            } => Phase::Bidding(Bidding {
                to_act: *to_act,
                best: *best,
                passed: passed.clone(),
                has_bid: has_bid.clone(),
            }),
            PhaseView::Play {
                declarer,
                contract,
                call,
                friend,
                trick_no,
                leader,
                lead,
                plays,
                called_joker,
                tricks,
                discards,
                // Derived from the plays; the rebuilt state works them out again.
                leading: _,
                no_friend: _,
            } => {
                for t in tricks {
                    taken[t.winner].extend(t.plays.iter().map(|p| p.card));
                }
                Phase::Play(Play {
                    declared: Declared {
                        declarer: *declarer,
                        contract: *contract,
                        // Dealt face down when not seen.
                        discards: discards.clone().unwrap_or_default(),
                    },
                    call: *call,
                    friend: *friend,
                    trick_no: *trick_no,
                    leader: *leader,
                    lead: *lead,
                    plays: plays.clone(),
                    called_joker: *called_joker,
                    tricks: tricks.clone(),
                })
            }
            PhaseView::Exchange {
                declarer,
                contract,
                trump_changed,
                discards,
            } => Phase::Exchange(Exchange {
                declared: Declared {
                    declarer: *declarer,
                    contract: *contract,
                    discards: discards.clone().unwrap_or_default(),
                },
                trump_changed: *trump_changed,
            }),
            PhaseView::Dealing | PhaseView::Done { .. } => return None,
        };
        Some(State {
            rules: view.rules.clone(),
            first_bidder: view.first_bidder,
            phase,
            hands: Vec::new(),
            kitty: Vec::new(),
            taken,
            bids: view.bids.clone(),
            redealt: view.redealt.clone(),
        })
    }

    /// Deals the cards a world from [`State::from_public`] lacks: `me`
    /// holds `own`, every other seat its set in `hands`, and `down` lie face
    /// down (the kitty while bidding; the discards in play, when unseen).
    pub(crate) fn fill_hidden(&mut self, me: Seat, own: &[Card], hands: &[CardSet], down: Vec<Card>) {
        let seats = self.seats();
        self.hands.resize(seats, Vec::new());
        for (seat, hand) in self.hands.iter_mut().enumerate() {
            hand.clear();
            if seat == me {
                hand.extend(own);
                hand.sort();
            } else {
                // In card order already.
                hand.extend(hands[seat].iter());
            }
        }
        match &mut self.phase {
            Phase::Bidding(_) => self.kitty = down,
            Phase::Play(p) if !down.is_empty() => p.declared.discards = down,
            _ => {}
        }
    }

    /// This hand, in play, wound back to the declarer's friend call: every
    /// seat holding `hands` (as the play began), the discards made, nothing
    /// won yet. Replaying the call and the cards since through
    /// [`State::step`] brings it back to the trick under way.
    pub(crate) fn before_call(&self, hands: Vec<Vec<Card>>) -> Option<State> {
        let Phase::Play(p) = &self.phase else { return None };
        Some(State {
            rules: self.rules.clone(),
            first_bidder: self.first_bidder,
            phase: Phase::Exchange(Exchange {
                declared: p.declared.clone(),
                // The call comes after any change, which no longer matters.
                trump_changed: false,
            }),
            hands,
            kitty: Vec::new(),
            taken: vec![Vec::new(); self.seats()],
            bids: self.bids.clone(),
            redealt: None,
        })
    }

    pub(crate) fn seats(&self) -> usize {
        self.rules.players
    }

    pub(crate) fn phase(&self) -> &Phase {
        &self.phase
    }

    #[cfg(test)]
    pub(crate) fn phase_mut(&mut self) -> &mut Phase {
        &mut self.phase
    }

    pub(crate) fn first_bidder(&self) -> Seat {
        self.first_bidder
    }

    /// Every seat's hand, each sorted.
    pub(crate) fn hands(&self) -> &[Vec<Card>] {
        &self.hands
    }

    pub(crate) fn kitty(&self) -> &[Card] {
        &self.kitty
    }

    /// Every card each seat won in tricks.
    pub(crate) fn taken(&self) -> &[Vec<Card>] {
        &self.taken
    }

    pub(crate) fn bids(&self) -> &[Bid] {
        &self.bids
    }

    pub(crate) fn redealt(&self) -> Option<&Redealt> {
        self.redealt.as_ref()
    }

    pub(crate) fn turn(&self) -> Turn {
        match &self.phase {
            Phase::Dealing => Turn::Chance,
            Phase::Bidding(b) => Turn::Seat(b.to_act),
            Phase::Exchange(e) => Turn::Seat(e.declared.declarer),
            Phase::Play(p) => Turn::Seat((p.leader + p.plays.len()) % self.seats()),
            Phase::Done(_) => Turn::Over,
        }
    }

    pub(crate) fn sample_deal(&self, rng: &mut dyn RngCore) -> Action {
        let mut deck = self.rules.cards();
        deck.shuffle(rng);
        let kitty = deck.split_off(self.seats() * self.rules.hand_size);
        let hands = deck.chunks(self.rules.hand_size).map(<[Card]>::to_vec).collect();
        Action::Deal { hands, kitty }
    }

    pub(crate) fn apply(&mut self, action: Action) -> Result<(), Error> {
        match self.turn() {
            Turn::Over => Err(Error::Over),
            Turn::Chance => match action {
                Action::Deal { hands, kitty } => self.deal(hands, kitty),
                other => Err(Error::Illegal(other)),
            },
            Turn::Seat(seat) => {
                if !self.legal_actions().contains(&action) {
                    return Err(Error::Illegal(action));
                }
                self.step(seat, action);
                Ok(())
            }
        }
    }

    fn deal(&mut self, mut hands: Vec<Vec<Card>>, kitty: Vec<Card>) -> Result<(), Error> {
        if hands.len() != self.seats() || hands.iter().any(|h| h.len() != self.rules.hand_size) {
            return Err(Error::BadDeal("wrong hand sizes"));
        }
        let mut dealt: Vec<Card> = hands.iter().flatten().chain(&kitty).copied().collect();
        let mut deck = self.rules.cards();
        dealt.sort();
        deck.sort();
        if dealt != deck {
            return Err(Error::BadDeal("cards are not exactly one deck"));
        }
        for hand in &mut hands {
            hand.sort();
        }
        let n = self.seats();
        self.hands = hands;
        self.kitty = kitty;
        self.taken = vec![Vec::new(); n];
        self.phase = Phase::Bidding(Bidding {
            to_act: self.first_bidder,
            best: None,
            passed: vec![false; n],
            has_bid: vec![false; n],
        });
        Ok(())
    }

    fn redeal(&mut self, why: Redeal) {
        let count = self.redealt.as_ref().map_or(0, |r| r.count) + 1;
        self.redealt = Some(Redealt { why, count });
        for hand in &mut self.hands {
            hand.clear();
        }
        self.kitty.clear();
        self.bids.clear();
        self.phase = Phase::Dealing;
    }

    fn trump_options(&self) -> Vec<Option<Suit>> {
        let mut trumps: Vec<Option<Suit>> = Suit::ALL.map(Some).to_vec();
        if self.rules.bidding.allow_no_trump {
            trumps.push(None);
        }
        trumps
    }

    pub(crate) fn legal_actions(&self) -> Vec<Action> {
        match &self.phase {
            Phase::Dealing | Phase::Done(_) => Vec::new(),
            Phase::Bidding(b) => self.legal_bids(b),
            Phase::Exchange(e) => self.legal_exchange(e),
            Phase::Play(p) => self.legal_plays(p),
        }
    }

    /// Whether `seat` may throw the deal in now, on their turn or not:
    /// their hand qualifies, they are still in the bidding (a pass has had
    /// its say), and the window is open. With `misdeal.ask_first` it stays
    /// open for everyone until the first bid; otherwise until the seat
    /// itself bids, or all through the bidding with
    /// `misdeal.after_bidding`.
    fn may_misdeal(&self, b: &Bidding, seat: Seat) -> bool {
        let misdeal = &self.rules.misdeal;
        let open = if misdeal.ask_first {
            b.best.is_none()
        } else {
            !b.has_bid[seat] || misdeal.after_bidding
        };
        open && !b.passed[seat] && self.rules.is_misdeal(&self.hands[seat])
    }

    /// See [`engine::Game::out_of_turn_actions`]: a misdeal, from the
    /// moment the cards land, for a seat that may call one.
    pub(crate) fn out_of_turn_actions(&self, seat: Seat) -> Vec<Action> {
        match &self.phase {
            Phase::Bidding(b) if seat < self.seats() && seat != b.to_act && self.may_misdeal(b, seat) => {
                vec![Action::Misdeal]
            }
            _ => Vec::new(),
        }
    }

    pub(crate) fn apply_out_of_turn(&mut self, seat: Seat, action: Action) -> Result<(), Error> {
        if !self.out_of_turn_actions(seat).contains(&action) {
            return Err(Error::Illegal(action));
        }
        self.step(seat, action);
        Ok(())
    }

    /// The rules this hand is played by.
    pub fn rules(&self) -> &Rules {
        &self.rules
    }

    /// The rules, shared: views and searches hold them without a copy.
    pub(crate) fn shared_rules(&self) -> &Arc<Rules> {
        &self.rules
    }

    /// The contract the declarer would play after `action` in the
    /// exchange: a trump change at its cost, or a raise. None for any
    /// other action, or outside the exchange.
    pub fn contract_after(&self, action: &Action) -> Option<Contract> {
        let Phase::Exchange(e) = &self.phase else { return None };
        match *action {
            Action::ChangeTrump(trump) => Some(self.changed_contract(e.declared.contract, trump)),
            Action::Raise(contract) => Some(contract),
            _ => None,
        }
    }

    /// Why each card in the hand of the seat to play may not be played
    /// now (see [`crate::explain`]); empty outside play.
    pub fn unplayable(&self) -> Vec<(Card, crate::explain::Refusal)> {
        let Phase::Play(p) = &self.phase else { return Vec::new() };
        let seat = (p.leader + p.plays.len()) % self.seats();
        crate::explain::refusals(&self.rules, &self.hands[seat], p.trick(), |j| self.joker_gone(j))
    }

    /// Whether the bidding is on and nobody has bid yet (passes aside).
    pub fn before_first_bid(&self) -> bool {
        matches!(&self.phase, Phase::Bidding(b) if b.best.is_none())
    }

    /// What `seat` could do were it their turn to bid now. Bots use it to
    /// decide on a misdeal out of turn as they would on their turn.
    pub fn bids_as(&self, seat: Seat) -> Vec<Action> {
        match &self.phase {
            Phase::Bidding(b) if seat < self.seats() && !b.passed[seat] => {
                let b = Bidding {
                    to_act: seat,
                    ..b.clone()
                };
                self.legal_bids(&b)
            }
            _ => Vec::new(),
        }
    }

    fn legal_bids(&self, b: &Bidding) -> Vec<Action> {
        let bidding = &self.rules.bidding;
        let mut actions = Vec::new();
        if self.may_misdeal(b, b.to_act) {
            actions.push(Action::Misdeal);
        }
        let min = if self.last_chance(b) {
            bidding.last_chance_min.unwrap_or(bidding.min)
        } else {
            bidding.min
        };
        if b.best.is_some() || bidding.first_bidder_may_pass {
            actions.push(Action::Pass);
        }
        actions.extend(self.bids_from(b.best.map(|(_, c)| c), min).map(Action::Bid));
        actions
    }

    /// Whether everyone has passed once and the first bidder is having
    /// the extra turn `bidding.last_chance_min` gives.
    fn last_chance(&self, b: &Bidding) -> bool {
        self.rules.bidding.last_chance_min.is_some() && b.best.is_none() && self.bids.len() == self.seats()
    }

    /// Every bid that would top `best`, lowest first within each trump.
    fn bids_over(&self, best: Option<Contract>) -> impl Iterator<Item = Contract> + '_ {
        self.bids_from(best, self.rules.bidding.min)
    }

    fn bids_from(&self, best: Option<Contract>, min: u8) -> impl Iterator<Item = Contract> + '_ {
        let bidding = &self.rules.bidding;
        self.trump_options().into_iter().flat_map(move |trump| {
            (1..=bidding.max)
                .map(move |count| Contract { trump, count })
                .filter(move |&contract| {
                    let beats_best = best.is_none_or(|best| self.rules.bid_rank(contract) > self.rules.bid_rank(best));
                    self.rules.bid_value(contract) >= min && beats_best
                })
        })
    }

    fn changed_contract(&self, contract: Contract, trump: Option<Suit>) -> Contract {
        self.rules.changed_contract(contract, trump)
    }

    /// Contracts the declarer may raise `contract` to: the same trump with
    /// a higher number, or another trump worth more than the least change,
    /// which `ChangeTrump` offers.
    fn raises(&self, contract: Contract) -> impl Iterator<Item = Contract> + '_ {
        let max = self.rules.bidding.max;
        self.trump_options().into_iter().flat_map(move |trump| {
            let least = self.changed_contract(contract, trump);
            (1..=max).map(move |count| Contract { trump, count }).filter(move |c| {
                if trump == contract.trump {
                    c.count > contract.count
                } else {
                    c.count > least.count
                }
            })
        })
    }

    fn legal_exchange(&self, e: &Exchange) -> Vec<Action> {
        let hand = &self.hands[e.declared.declarer];
        let mut actions = Vec::new();
        if e.declared.discards.len() < self.rules.kitty_size() {
            // Holding the kitty, a hand that qualifies may still be thrown in.
            if self.rules.misdeal.declarer && e.declared.discards.is_empty() && self.rules.is_misdeal(hand) {
                actions.push(Action::Misdeal);
            }
            if !e.trump_changed && e.declared.discards.is_empty() {
                for trump in self.trump_options() {
                    let changed = self.changed_contract(e.declared.contract, trump);
                    if trump != e.declared.contract.trump && changed.count <= self.rules.bidding.max {
                        actions.push(Action::ChangeTrump(trump));
                    }
                }
                if self.rules.bidding.raise_on_exchange {
                    actions.extend(self.raises(e.declared.contract).map(Action::Raise));
                }
            }
            actions.extend(hand.iter().map(|&c| Action::Discard(c)));
            return actions;
        }
        let f = &self.rules.friend;
        if f.by_card {
            for card in self.rules.cards() {
                let own = hand.contains(&card) || e.declared.discards.contains(&card);
                if !own || f.fake {
                    actions.push(Action::CallFriend(FriendCall::Card(card)));
                }
            }
        }
        if f.by_seat {
            let others = (0..self.seats()).filter(|&s| s != e.declared.declarer);
            actions.extend(others.map(|s| Action::CallFriend(FriendCall::Seat(s))));
        }
        for (enabled, call) in [
            (f.first_trick, FriendCall::FirstTrick),
            (f.last_trick, FriendCall::LastTrick),
            (f.alone, FriendCall::Alone),
        ] {
            if enabled {
                actions.push(Action::CallFriend(call));
            }
        }
        actions
    }

    fn legal_plays(&self, p: &Play) -> Vec<Action> {
        let seat = (p.leader + p.plays.len()) % self.seats();
        legal_plays(&self.rules, &self.hands[seat], p.trick(), |j| self.joker_gone(j))
    }

    /// Whether `joker` was won in a finished trick.
    fn joker_gone(&self, joker: Card) -> bool {
        self.taken.iter().any(|t| t.contains(&joker))
    }

    /// Applies an action already known to be legal.
    pub(crate) fn step(&mut self, seat: Seat, action: Action) {
        let phase = std::mem::replace(&mut self.phase, Phase::Dealing);
        self.phase = match (phase, action) {
            (Phase::Bidding(_) | Phase::Exchange(_), Action::Misdeal) => {
                let hand = self.hands[seat].clone();
                self.redeal(Redeal::Misdeal { seat, hand });
                if self.rules.misdeal.caller_deals {
                    self.first_bidder = seat;
                }
                Phase::Dealing
            }
            (Phase::Bidding(b), action) => self.step_bidding(b, seat, action),
            (Phase::Exchange(e), action) => self.step_exchange(e, action),
            (
                Phase::Play(p),
                Action::Play {
                    card,
                    joker_lead,
                    call_joker,
                },
            ) => self.step_play(p, seat, card, joker_lead, call_joker),
            (phase, action) => unreachable!("legal action {action:?} in phase {phase:?}"),
        };
    }

    fn step_bidding(&mut self, mut b: Bidding, seat: Seat, action: Action) -> Phase {
        let n = self.seats();
        let contract = match action {
            Action::Pass => {
                b.passed[seat] = true;
                None
            }
            Action::Bid(contract) => {
                b.best = Some((seat, contract));
                b.has_bid[seat] = true;
                if !self.rules.bidding.pass_is_final {
                    // Everyone else may answer, even those who passed.
                    b.passed.fill(false);
                }
                Some(contract)
            }
            other => unreachable!("{other:?} while bidding"),
        };
        self.bids.push(Bid { seat, contract });
        let active = b.passed.iter().filter(|p| !**p).count();
        // A bid nobody can top (풀노) ends the bidding at once.
        let unbeatable = contract.is_some_and(|c| self.bids_over(Some(c)).next().is_none());
        match (active, b.best) {
            // Everyone passed once: the first bidder may bid once more.
            (0, None) if self.last_chance(&b) => {
                b.passed[self.first_bidder] = false;
                b.to_act = self.first_bidder;
                Phase::Bidding(b)
            }
            (0, _) => {
                self.redeal(Redeal::AllPassed);
                Phase::Dealing
            }
            (_, Some((declarer, contract))) if active == 1 || unbeatable => {
                self.redealt = None;
                let kitty = std::mem::take(&mut self.kitty);
                self.hands[declarer].extend(kitty);
                self.hands[declarer].sort();
                Phase::Exchange(Exchange {
                    declared: Declared {
                        declarer,
                        contract,
                        discards: Vec::new(),
                    },
                    trump_changed: false,
                })
            }
            _ => {
                b.to_act = (1..=n)
                    .map(|i| (seat + i) % n)
                    .find(|&s| !b.passed[s])
                    .expect("someone is active");
                Phase::Bidding(b)
            }
        }
    }

    fn step_exchange(&mut self, mut e: Exchange, action: Action) -> Phase {
        match action {
            Action::ChangeTrump(trump) => {
                e.declared.contract = self.changed_contract(e.declared.contract, trump);
                e.trump_changed = true;
            }
            Action::Raise(contract) => {
                e.declared.contract = contract;
                e.trump_changed = true;
            }
            Action::Discard(card) => {
                let hand = &mut self.hands[e.declared.declarer];
                hand.retain(|&c| c != card);
                e.declared.discards.push(card);
            }
            Action::CallFriend(call) => {
                return Phase::Play(Play {
                    leader: e.declared.declarer,
                    declared: e.declared,
                    call,
                    friend: match call {
                        FriendCall::Seat(s) => Some(s),
                        _ => None,
                    },
                    trick_no: 0,
                    lead: None,
                    plays: Vec::new(),
                    called_joker: None,
                    tricks: Vec::new(),
                });
            }
            other => unreachable!("{other:?} during exchange"),
        }
        Phase::Exchange(e)
    }

    /// The seat whose card is winning the trick so far, by the same rule
    /// that settles a finished trick. None before the first card.
    pub(crate) fn leading(&self, p: &Play) -> Option<Seat> {
        Some(p.plays[p.trick().winner(&self.rules, &p.plays)?].seat)
    }

    fn step_play(&mut self, mut p: Play, seat: Seat, card: Card, joker_lead: Option<Lead>, call: bool) -> Phase {
        self.hands[seat].retain(|&c| c != card);
        if p.plays.is_empty() {
            let t = p
                .trick()
                .led(&self.rules, card, joker_lead, call, |j| self.joker_gone(j));
            p.lead = t.lead;
            p.called_joker = t.called_joker;
        }
        p.plays.push(p.trick().played(&self.rules, seat, card));
        if p.call == FriendCall::Card(card) && seat != p.declared.declarer {
            p.friend = Some(seat);
        }
        if p.plays.len() < self.seats() {
            return Phase::Play(p);
        }

        let lead = p.lead.expect("a finished trick has a lead");
        let winner = self.leading(&p).expect("a finished trick has a leader");
        self.taken[winner].extend(p.plays.iter().map(|pl| pl.card));
        let last = p.trick_no + 1 == self.rules.hand_size;
        let reveals = match p.call {
            FriendCall::FirstTrick => p.trick_no == 0,
            FriendCall::LastTrick => last,
            _ => false,
        };
        if reveals && winner != p.declared.declarer && p.friend.is_none() {
            p.friend = Some(winner);
        }
        let plays = std::mem::take(&mut p.plays);
        p.tricks.push(Trick { plays, lead, winner });
        let next = p.trick().next();
        p.trick_no = next.trick_no;
        p.lead = next.lead;
        p.called_joker = next.called_joker;
        p.leader = winner;
        if last {
            Phase::Done(self.score(p))
        } else {
            Phase::Play(p)
        }
    }

    fn score(&self, p: Play) -> Done {
        let team = |s: Seat| s == p.declared.declarer || Some(s) == p.friend;
        let won_points = (0..self.seats()).filter(|&s| team(s)).flat_map(|s| &self.taken[s]);
        let won = won_points.filter(|c| c.is_point()).count();
        let team_points = (won + discard_points(&self.rules, &p.declared.discards)) as u8;
        let payoffs = settle(
            &self.rules,
            p.declared.declarer,
            p.friend,
            p.declared.contract,
            p.call,
            team_points,
        );
        Done {
            declared: p.declared,
            call: p.call,
            friend: p.friend,
            team_points,
            payoffs,
            tricks: p.tricks,
        }
    }

    /// What one opponent pays the declarer's side (negative: receives) when
    /// the side took `team_points`; see [`hand_value`].
    #[cfg(test)]
    fn hand_value(&self, contract: Contract, alone: bool, team_points: u8) -> i64 {
        hand_value(&self.rules, contract, alone, team_points)
    }

    /// What the bidding settled, once it is over.
    pub(crate) fn declared(&self) -> Option<&Declared> {
        match &self.phase {
            Phase::Exchange(e) => Some(&e.declared),
            Phase::Play(p) => Some(&p.declared),
            Phase::Done(d) => Some(&d.declared),
            Phase::Dealing | Phase::Bidding(_) => None,
        }
    }

    fn declared_mut(&mut self) -> Option<&mut Declared> {
        match &mut self.phase {
            Phase::Exchange(e) => Some(&mut e.declared),
            Phase::Play(p) => Some(&mut p.declared),
            Phase::Done(d) => Some(&mut d.declared),
            Phase::Dealing | Phase::Bidding(_) => None,
        }
    }

    /// The finished hand in brief, once it is over.
    pub fn summary(&self) -> Option<HandSummary> {
        let Phase::Done(d) = &self.phase else { return None };
        let team = |s: Seat| s == d.declared.declarer || Some(s) == d.friend;
        let rounds = d
            .tricks
            .iter()
            .map(|t| {
                let points = t.plays.iter().filter(|p| p.card.is_point()).count() as i8;
                if team(t.winner) { points } else { -points }
            })
            .collect();
        let friend_revealed = d.friend.and_then(|friend| match d.call {
            FriendCall::Seat(_) | FriendCall::FirstTrick => Some(0),
            FriendCall::Card(card) => d
                .tricks
                .iter()
                .position(|t| t.plays.iter().any(|p| p.seat == friend && p.card == card)),
            FriendCall::LastTrick => Some(d.tricks.len().saturating_sub(1)),
            FriendCall::Alone => None,
        });
        Some(HandSummary {
            contract: d.declared.contract,
            declarer: d.declared.declarer,
            friend: d.friend,
            made: d.team_points >= d.declared.contract.count,
            team_points: d.team_points,
            rounds,
            friend_revealed,
        })
    }

    pub(crate) fn payoffs(&self) -> Option<Vec<i64>> {
        match &self.phase {
            Phase::Done(d) => Some(d.payoffs.clone()),
            _ => None,
        }
    }

    pub(crate) fn reshuffle_hidden(&self, viewer: engine::Viewer, rng: &mut dyn RngCore) -> State {
        let me = match viewer {
            engine::Viewer::Seat(s) => Some(s),
            engine::Viewer::Spectator => None,
        };
        // Everyone sees the discards once the hand is over, if the rules show them.
        let shown = matches!(self.phase, Phase::Done(_)) && self.rules.reveal_discards;
        let sees_discards = shown || self.declared().is_some_and(|d| Some(d.declarer) == me);
        let mut next = self.clone();

        let mut pool: Vec<Card> = Vec::new();
        for (s, hand) in next.hands.iter().enumerate() {
            if Some(s) != me {
                pool.extend(hand);
            }
        }
        pool.extend(&next.kitty);
        if !sees_discards {
            pool.extend(next.declared().map(|d| d.discards.clone()).unwrap_or_default());
        }
        pool.shuffle(rng);

        let mut deal = |n: usize| pool.drain(..n).collect::<Vec<Card>>();
        for s in 0..next.seats() {
            if Some(s) != me {
                let n = next.hands[s].len();
                next.hands[s] = deal(n);
                next.hands[s].sort();
            }
        }
        next.kitty = deal(next.kitty.len());
        if !sees_discards && let Some(d) = next.declared_mut() {
            let n = d.discards.len();
            d.discards = pool.drain(..n).collect();
        }
        next
    }

    pub(crate) fn check_invariants(&self) -> Result<(), String> {
        let hand_size = self.rules.hand_size;
        if let Phase::Dealing = self.phase {
            let empty = self.hands.iter().chain(&self.taken).all(Vec::is_empty) && self.kitty.is_empty();
            return if empty {
                Ok(())
            } else {
                Err("cards on the table while dealing".into())
            };
        }

        let mut cards: Vec<Card> = self.hands.iter().chain(&self.taken).flatten().copied().collect();
        cards.extend(&self.kitty);
        cards.extend(self.declared().map(|d| d.discards.clone()).unwrap_or_default());
        if let Phase::Play(p) = &self.phase {
            cards.extend(p.plays.iter().map(|pl| pl.card));
        }
        let mut deck = self.rules.cards();
        cards.sort();
        deck.sort();
        if cards != deck {
            return Err(format!("cards created or lost: have {} of {}", cards.len(), deck.len()));
        }

        match &self.phase {
            Phase::Bidding(b) => {
                if self.hands.iter().any(|h| h.len() != hand_size) {
                    return Err("hand size changed during bidding".into());
                }
                let last = self.bids.iter().rev().find_map(|bid| Some((bid.seat, bid.contract?)));
                // Passes since the last bid, when a bid lets everyone answer again.
                let counted = if self.rules.bidding.pass_is_final {
                    &self.bids[..]
                } else {
                    let since = self
                        .bids
                        .iter()
                        .rposition(|bid| bid.contract.is_some())
                        .map_or(0, |i| i + 1);
                    &self.bids[since..]
                };
                let passes = counted.iter().filter(|bid| bid.contract.is_none()).count();
                // On the first bidder's extra turn, their pass no longer counts.
                let passes = passes - usize::from(self.last_chance(b));
                if last != b.best || passes != b.passed.iter().filter(|p| **p).count() {
                    return Err("the bidding record disagrees with the bidding".into());
                }
                if b.best
                    .is_some_and(|(_, best)| self.bids_over(Some(best)).next().is_none())
                {
                    return Err("the bidding went on past a bid nobody can top".into());
                }
                if b.passed[b.to_act] {
                    return Err(format!("seat {} is to bid but has passed", b.to_act));
                }
            }
            Phase::Play(p) => {
                for (s, hand) in self.hands.iter().enumerate() {
                    let played = usize::from(p.plays.iter().any(|pl| pl.seat == s));
                    if hand.len() + p.trick_no + played != hand_size {
                        return Err(format!("seat {s} holds {} cards on trick {}", hand.len(), p.trick_no));
                    }
                }
            }
            Phase::Done(d) => {
                if d.payoffs.iter().sum::<i64>() != 0 {
                    return Err(format!("payoffs do not sum to zero: {:?}", d.payoffs));
                }
                if d.team_points > 20 {
                    return Err(format!("the declarer's side took {} of 20 points", d.team_points));
                }
                // A made contract never costs the declarer, a failed one always
                // does; only scoring against the minimum can lose on a win.
                let made = d.team_points >= d.declared.contract.count;
                let declarer = d.payoffs[d.declared.declarer];
                let may_lose = self.rules.scoring.win == WinScore::OverMin;
                if (made && declarer < 0 && !may_lose) || (!made && declarer >= 0) {
                    return Err(format!(
                        "declarer gets {declarer} for {} of {}",
                        d.team_points, d.declared.contract.count
                    ));
                }
            }
            Phase::Dealing | Phase::Exchange(_) => {}
        }
        Ok(())
    }
}

/// The legal plays from `hand` into trick `t`. `gone` tells whether a
/// joker was won in a finished trick, which ends calling it. Shared by the
/// game and by [`crate::endgame`], which plays tricks out without a [`State`].
pub(crate) fn legal_plays(rules: &Rules, hand: &[Card], t: TrickState, gone: impl Fn(Card) -> bool) -> Vec<Action> {
    let trump = t.trump;
    let mighty = rules.mighty(trump);
    let policy = |c: &Card| rules.policy(*c, trump, t.trick_no);
    let leading = t.lead.is_none();

    // A card held back by policy may still be played when nothing else
    // is left but jokers and the mighty: holding only trump and those
    // means trump may be played too. Without `release_with_mighty`, only
    // jokers count: holding the mighty, the mighty must go. Searches call
    // this often, so the cards are picked without building lists along
    // the way.
    let with_mighty = rules.policy.release_with_mighty;
    let special = |c: &Card| c.is_joker() || (with_mighty && *c == mighty);
    let pick = |candidate: &dyn Fn(&Card) -> bool, allowed: &dyn Fn(&Card) -> bool| -> Vec<Card> {
        let forced = hand.iter().filter(|c| candidate(c) && allowed(c)).all(special);
        hand.iter()
            .copied()
            .filter(|c| candidate(c) && (forced || allowed(c)))
            .collect()
    };
    let cards: Vec<Card> = if let Some(lead) = t.lead {
        if let Some(joker) = t.called_joker.filter(|j| hand.contains(j)) {
            // A called joker must come out, rules above notwithstanding.
            let defend = rules.joker_call.mighty_defense && hand.contains(&mighty);
            std::iter::once(joker).chain(defend.then_some(mighty)).collect()
        } else {
            // The mighty and jokers may always be played and never oblige following.
            let free = |c: &Card| *c == mighty || c.is_joker();
            // The mighty still belongs to its suit: when that suit is led
            // and the mighty is all of it in hand, the mighty must follow.
            let follows = hand.iter().any(|c| !c.is_joker() && lead.follows(*c));
            // Held-back cards (such as trump on the first trick) may still
            // follow: a joker can name a suit that is otherwise held back.
            pick(&|c| !follows || free(c) || lead.follows(*c), &|c| {
                policy(c) != CardPolicy::Invalid || (follows && !free(c))
            })
        }
    } else {
        // Where a joker may not lead the first trick, it stays barred even
        // when trump is released, unless it is all there is.
        let barred = |c: &Card| c.is_joker() && t.trick_no == 0 && rules.joker_lead.not_first_trick;
        let any_unbarred = hand.iter().any(|c| !barred(c));
        pick(&|c| !any_unbarred || !barred(c), &|c| {
            !matches!(policy(c), CardPolicy::Invalid | CardPolicy::NoLead) && !barred(c)
        })
    };

    let mut actions = Vec::with_capacity(cards.len() + 1);
    for card in cards {
        let play = |joker_lead, call_joker| Action::Play {
            card,
            joker_lead,
            call_joker,
        };
        if leading && card.is_joker() {
            let two_jokers = rules.deck.jokers().len() > 1;
            let own = joker_color(card);
            for suit in Suit::ALL {
                if !two_jokers || Some(suit.color()) == own {
                    actions.push(play(Some(Lead::Suit(suit)), false));
                }
            }
            if rules.joker_lead.by_color {
                for color in [Color::Black, Color::Red] {
                    if !two_jokers || Some(color) == own {
                        actions.push(play(Some(Lead::Color(color)), false));
                    }
                }
            }
        } else {
            actions.push(play(None, false));
            if leading && callable_joker(rules, t, card, &gone).is_some() {
                actions.push(play(None, true));
            }
        }
    }
    actions
}

/// The joker that leading `card` into trick `t` would call, if a call is
/// possible then.
pub(crate) fn callable_joker(rules: &Rules, t: TrickState, card: Card, gone: impl Fn(Card) -> bool) -> Option<Card> {
    if rules.on_trick(rules.policy.joker_call, t.trick_no) != CardPolicy::Valid {
        return None;
    }
    rules
        .deck
        .jokers()
        .iter()
        .copied()
        .find(|&joker| !gone(joker) && rules.joker_call_card(joker, t.trump) == Some(card))
}

/// Whether `card` keeps its power when played into trick `t` (its lead and
/// call already set).
pub(crate) fn powered(rules: &Rules, t: TrickState, card: Card) -> bool {
    let called_and_powerless = t.called_joker == Some(card) && !rules.joker_call.called_joker_has_power;
    rules.policy(card, t.trump, t.trick_no) != CardPolicy::NoEffect && !called_and_powerless
}

/// What one opponent pays the declarer's side (negative: receives) when
/// the side took `team_points`. Shared by the game and by
/// [`crate::endgame`]; see [`crate::score`].
pub(crate) fn hand_value(rules: &Rules, contract: Contract, alone: bool, team_points: u8) -> i64 {
    crate::score::value(rules, contract, alone, team_points)
}

/// The points the declarer's side counts from its discards: their point
/// cards, unless the rules give them to the defence.
pub(crate) fn discard_points(rules: &Rules, discards: &[Card]) -> usize {
    if rules.scoring.discards_to_declarer {
        discards.iter().filter(|c| c.is_point()).count()
    } else {
        0
    }
}

/// Whether what the declarer's side gets never falls as its points rise,
/// for this contract: then the side's best play for points is its best
/// play for payoff too. Scoring against the minimum can break this (a
/// made contract worth less than a narrowly failed one).
pub(crate) fn payoff_rises_with_points(rules: &Rules, contract: Contract, alone: bool) -> bool {
    let values: Vec<i64> = (0..=20)
        .map(|points| hand_value(rules, contract, alone, points))
        .collect();
    values.windows(2).all(|w| w[0] <= w[1])
}

/// Every seat's payoff when the declarer's side ends with `team_points`.
pub fn settle(
    rules: &Rules,
    declarer: Seat,
    friend: Option<Seat>,
    contract: Contract,
    call: FriendCall,
    team_points: u8,
) -> Vec<i64> {
    let seats = rules.players;
    let team = |s: Seat| s == declarer || Some(s) == friend;
    let value = hand_value(rules, contract, call == FriendCall::Alone, team_points);
    let opponents = (0..seats).filter(|&s| !team(s)).count() as i64;
    (0..seats)
        .map(|s| {
            if s == declarer {
                value * opponents - if friend.is_some() { value } else { 0 }
            } else if team(s) {
                value
            } else {
                -value
            }
        })
        .collect()
}

fn joker_color(card: Card) -> Option<Color> {
    match card {
        Card::Joker(color) => Some(color),
        Card::Normal(..) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::{BackRun, Doubling, LoseScore, Scoring};

    fn state(rules: Rules) -> State {
        State::new(&Options { rules, first_bidder: 0 }).unwrap()
    }

    const DIAMOND: Option<Suit> = Some(Suit::Diamond);

    /// 나무위키's worked examples (점수 계산), scored the usual way: points −
    /// contract + 2 × (contract − 13), no-trump and runs double, a failed
    /// contract doubles when the defence took 11 or more.
    #[test]
    fn the_usual_scoring_matches_the_worked_examples() {
        let rules = Rules {
            scoring: Scoring {
                win: WinScore::BidBonus,
                lose: LoseScore::Shortfall,
                no_trump: Doubling::Win,
                alone: Doubling::Never,
                run: true,
                back_run: BackRun::TeamAtMost(9),
                full_contract: Doubling::Never,
                discards_to_declarer: true,
            },
            ..Rules::default()
        };
        let s = state(rules);
        let value = |trump, count, alone, points| s.hand_value(Contract { trump, count }, alone, points);
        assert_eq!(value(DIAMOND, 15, false, 19), 8);
        assert_eq!(value(DIAMOND, 15, false, 20), 18);
        assert_eq!(value(None, 15, true, 16), 10);
        assert_eq!(value(DIAMOND, 15, false, 14), -1);
        assert_eq!(value(DIAMOND, 15, false, 9), -12);
        // No doubling for no-trump on a loss unless agreed.
        assert_eq!(value(None, 15, true, 9), -12);
    }

    #[test]
    fn scoring_against_the_minimum_can_lose_on_a_win() {
        let mut rules = Rules::default();
        rules.scoring.win = WinScore::OverMin;
        let s = state(rules);
        // 둘노 made with 12 against a minimum of 13: (12 − 13) × 2.
        assert_eq!(s.hand_value(Contract { trump: None, count: 12 }, false, 12), -2);
        assert_eq!(s.hand_value(Contract { trump: None, count: 12 }, false, 13), 0);
    }

    #[test]
    fn default_scoring_is_unchanged() {
        let s = state(Rules::default());
        let value = |trump, count, alone, points| s.hand_value(Contract { trump, count }, alone, points);
        assert_eq!(value(DIAMOND, 13, false, 15), 5);
        assert_eq!(value(None, 13, true, 20), 80);
        assert_eq!(value(DIAMOND, 13, false, 11), -2);
        assert_eq!(value(DIAMOND, 13, false, 10), -6);
        // A loss is never doubled for no-trump or playing alone.
        assert_eq!(value(None, 13, true, 12), -1);
    }

    #[test]
    fn doublings_may_apply_to_losses_too() {
        let mut rules = Rules::default();
        rules.scoring.no_trump = Doubling::Always;
        rules.scoring.alone = Doubling::Always;
        rules.scoring.back_run = BackRun::ShortBy(5);
        let s = state(rules);
        // 부산대: 13 bid, 8 taken is 백런; no-trump and 노프렌드 double too.
        assert_eq!(s.hand_value(Contract { trump: None, count: 13 }, true, 8), -40);
        assert_eq!(s.hand_value(Contract { trump: None, count: 13 }, true, 9), -16);
        let mut rules = Rules::default();
        rules.scoring.back_run = BackRun::DefenceReachesBid;
        let s = state(rules);
        // 세종: the defence took 13 of a 13 contract's points.
        assert_eq!(
            s.hand_value(
                Contract {
                    trump: DIAMOND,
                    count: 13
                },
                false,
                7
            ),
            -12
        );
        assert_eq!(
            s.hand_value(
                Contract {
                    trump: DIAMOND,
                    count: 13
                },
                false,
                8
            ),
            -5
        );
    }

    #[test]
    fn discards_may_count_for_the_defence() {
        let mut rules = Rules::default();
        rules.scoring.discards_to_declarer = false;
        let mut s = state(rules);
        let tens = Suit::ALL.map(|suit| Card::new(suit, 10));
        // The declarer won 12 points in tricks and buried three tens.
        let won: Vec<Card> = Suit::ALL
            .into_iter()
            .flat_map(|suit| (11..=13).map(move |r| Card::new(suit, r)))
            .collect();
        s.taken[0] = won;
        let play = Play {
            declared: Declared {
                declarer: 0,
                contract: Contract {
                    trump: DIAMOND,
                    count: 13,
                },
                discards: tens[..3].to_vec(),
            },
            call: FriendCall::Alone,
            friend: None,
            trick_no: 10,
            leader: 0,
            lead: None,
            plays: Vec::new(),
            called_joker: None,
            tricks: Vec::new(),
        };
        let done = s.score(play.clone());
        assert_eq!((done.team_points, done.payoffs[0]), (12, -4));
        Arc::make_mut(&mut s.rules).scoring.discards_to_declarer = true;
        assert_eq!(s.score(play).team_points, 15);
    }

    fn basic() -> State {
        state(crate::rules::Preset::Default.rules())
    }

    /// 기본: B = max(1, (P − 13) + (C − 13)) on a win, P − C on a loss;
    /// ×2 each for 노기루다, 노프렌드, 런, 백런 (P ≤ 10) and C = 20.
    #[test]
    fn basic_scoring() {
        let s = basic();
        assert_eq!(s.rules.scoring.lose, LoseScore::Shortfall);
        let value = |trump, count, alone, points| s.hand_value(Contract { trump, count }, alone, points);
        assert_eq!(value(DIAMOND, 15, false, 19), 8);
        assert_eq!(value(DIAMOND, 13, false, 13), 1);
        assert_eq!(value(DIAMOND, 15, false, 20), 2 * 9);
        assert_eq!(value(DIAMOND, 15, false, 14), -1);
        assert_eq!(value(DIAMOND, 15, false, 10), -2 * 5);
        // 노기루다 and 노프렌드 double whichever side wins.
        assert_eq!(value(None, 15, true, 16), 4 * 5);
        assert_eq!(value(None, 15, true, 14), -4);
        // C = 20 doubles too: 풀노 made alone with a run is ×16.
        assert_eq!(value(None, 20, true, 20), 16 * 14);
        assert_eq!(value(DIAMOND, 20, false, 15), -2 * 5);
    }

    /// The schools' G: made pays P − 10 (at least 1); failed pays back
    /// C − 10 plus the shortfall, then doubles as before (경기과고: 백런
    /// at 10 or fewer, nothing else doubles a loss). Seat 0 declares,
    /// seat 1 is the friend when there is one.
    #[test]
    fn a_failed_contract_pays_back_what_it_would_have_won() {
        let rules = crate::rules::Preset::Gshs.rules();
        assert_eq!(rules.scoring.lose, LoseScore::PaysBack(10));
        let pay = |trump, count, call, points| {
            let friend = (call != FriendCall::Alone).then_some(1);
            settle(&rules, 0, friend, Contract { trump, count }, call, points)
        };
        let friend = FriendCall::Seat(1);
        // Made exactly, and by two more.
        assert_eq!(pay(DIAMOND, 14, friend, 14), vec![8, 4, -4, -4, -4]);
        assert_eq!(pay(DIAMOND, 14, friend, 16), vec![12, 6, -6, -6, -6]);
        // Failed by 1: (14 − 10) + 1; by 3: (16 − 10) + 3.
        assert_eq!(pay(DIAMOND, 14, friend, 13), vec![-10, -5, 5, 5, 5]);
        assert_eq!(pay(DIAMOND, 16, friend, 13), vec![-18, -9, 9, 9, 9]);
        // 백런 (10 or fewer) doubles the whole loss: ((14 − 10) + 4) × 2.
        assert_eq!(pay(DIAMOND, 14, friend, 10), vec![-32, -16, 16, 16, 16]);
        assert_eq!(pay(DIAMOND, 14, friend, 11), vec![-14, -7, 7, 7, 7]);
        // Alone: the declarer pays all four; only a win doubles.
        let alone = FriendCall::Alone;
        assert_eq!(pay(DIAMOND, 14, alone, 12), vec![-24, 6, 6, 6, 6]);
        assert_eq!(pay(DIAMOND, 14, alone, 15), vec![40, -10, -10, -10, -10]);
        // 노기루다 15 failed by 2: (15 − 10) + 2, not doubled.
        assert_eq!(pay(None, 15, friend, 13), vec![-14, -7, 7, 7, 7]);
        assert_eq!(pay(None, 15, friend, 15), vec![20, 10, -10, -10, -10]);
    }

    /// Paying back starts from the contract, so a failed contract always
    /// costs more than under the shortfall alone, and every point taken
    /// still helps.
    #[test]
    fn paying_back_keeps_more_points_better() {
        for preset in crate::rules::Preset::ALL {
            let rules = preset.rules();
            for count in rules.lowest_contract()..=rules.bidding.max {
                for trump in [DIAMOND, None] {
                    for alone in [false, true] {
                        let contract = Contract { trump, count };
                        assert!(payoff_rises_with_points(&rules, contract, alone), "{preset} {count}");
                    }
                }
            }
        }
    }

    /// A finished hand of seat 0 declaring ♦15 with `call`, `friend`
    /// known, its side having taken 16 points.
    fn finish(s: &mut State, call: FriendCall, friend: Option<Seat>) -> Done {
        let points: Vec<Card> = Suit::ALL
            .into_iter()
            .flat_map(|suit| (11..=14).map(move |r| Card::new(suit, r)))
            .collect();
        s.taken = vec![Vec::new(); 5];
        s.taken[0] = points;
        let play = Play {
            declared: Declared {
                declarer: 0,
                contract: Contract {
                    trump: DIAMOND,
                    count: 15,
                },
                discards: Vec::new(),
            },
            call,
            friend,
            trick_no: 10,
            leader: 0,
            lead: None,
            plays: Vec::new(),
            called_joker: None,
            tricks: Vec::new(),
        };
        s.score(play)
    }

    #[test]
    fn basic_false_no_friend_scores_without_doubling() {
        let mut s = basic();
        // B = (16 − 13) + (15 − 13) = 5.
        let with_friend = finish(&mut s, FriendCall::Seat(1), Some(1));
        assert_eq!(with_friend.payoffs, vec![10, 5, -5, -5, -5]);
        let alone = finish(&mut s, FriendCall::Alone, None);
        assert_eq!(alone.payoffs, vec![40, -10, -10, -10, -10]);
        // Naming a card the declarer holds, or winning the first trick
        // when it calls the friend: no friend, but no doubling either.
        let false_alone = finish(&mut s, FriendCall::Card(Card::new(Suit::Spade, 14)), None);
        assert_eq!(false_alone.payoffs, vec![20, -5, -5, -5, -5]);
        let first_trick = finish(&mut s, FriendCall::FirstTrick, None);
        assert_eq!(first_trick.payoffs, vec![20, -5, -5, -5, -5]);
    }

    /// Trick 10 of 기본, seat 0 to lead `hand0`; the others hold one card each.
    fn last_trick(hand0: Card, others: [Card; 4]) -> State {
        let mut s = basic();
        s.hands = std::iter::once(vec![hand0]).chain(others.map(|c| vec![c])).collect();
        s.phase = Phase::Play(Play {
            declared: Declared {
                declarer: 0,
                contract: Contract {
                    trump: DIAMOND,
                    count: 14,
                },
                discards: Vec::new(),
            },
            call: FriendCall::Alone,
            friend: None,
            trick_no: 9,
            leader: 0,
            lead: None,
            plays: Vec::new(),
            called_joker: None,
            tricks: Vec::new(),
        });
        s
    }

    #[test]
    fn basic_last_trick_joker_call_does_nothing_and_a_led_weak_joker_can_win() {
        let joker = Card::Joker(Color::Black);
        let c = |s, r| Card::new(s, r);
        let s = last_trick(
            c(Suit::Club, 3),
            [joker, c(Suit::Club, 9), c(Suit::Spade, 9), c(Suit::Heart, 9)],
        );
        assert!(
            s.legal_actions()
                .iter()
                .all(|a| matches!(a, Action::Play { call_joker: false, .. }))
        );

        // The joker leads hearts, weak; nobody plays a heart, trump or the mighty.
        let mut s = last_trick(
            joker,
            [
                c(Suit::Club, 9),
                c(Suit::Spade, 9),
                c(Suit::Club, 10),
                c(Suit::Spade, 2),
            ],
        );
        let lead = Action::Play {
            card: joker,
            joker_lead: Some(Lead::Suit(Suit::Heart)),
            call_joker: false,
        };
        assert!(s.legal_actions().contains(&lead));
        s.step(0, lead);
        let Phase::Play(p) = &s.phase else { unreachable!() };
        assert!(!p.plays[0].powered);
        for seat in 1..5 {
            let card = s.hands[seat][0];
            s.step(
                seat,
                Action::Play {
                    card,
                    joker_lead: None,
                    call_joker: false,
                },
            );
        }
        let Phase::Done(d) = &s.phase else { unreachable!() };
        assert_eq!(d.tricks[0].winner, 0);
    }

    /// Hands scored by [`settle`], with their breakdowns, for the web
    /// client's wording of the count (`web/src/lib/ledger.ts`) to check
    /// itself against: every preset and a few drawn rule sets, each over contracts above and
    /// below the minimum, with and without a friend, failed, made and run.
    fn payoff_fixture() -> serde_json::Value {
        use crate::rules::Preset;
        use rand::SeedableRng;
        let mut sets: Vec<(String, Rules)> = Preset::ALL.iter().map(|p| (p.name().to_string(), p.rules())).collect();
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(7);
        for i in 0..10 {
            sets.push((format!("varied-{i}"), Rules::default().varied(&mut rng)));
        }
        // A bid under the minimum scored with the bid bonus: never a penalty.
        let mut bonus = Rules::default();
        bonus.scoring.win = WinScore::BidBonus;
        sets.push(("bid-bonus".into(), bonus));
        let sets: Vec<serde_json::Value> = sets
            .into_iter()
            .map(|(name, rules)| {
                let min = rules.bidding.min;
                let contracts = [
                    Contract {
                        trump: Some(Suit::Spade),
                        count: min - 1,
                    },
                    Contract {
                        trump: None,
                        count: min,
                    },
                    Contract {
                        trump: Some(Suit::Heart),
                        count: 20,
                    },
                ];
                let mut hands = Vec::new();
                for contract in contracts {
                    for alone in [false, true] {
                        let (call, friend) = if alone {
                            (FriendCall::Alone, None)
                        } else {
                            (FriendCall::Seat(1), Some(1))
                        };
                        for team_points in [0, contract.count - 1, contract.count, 20] {
                            hands.push(serde_json::json!({
                                "contract": contract,
                                "call": call,
                                "team_points": team_points,
                                "value": hand_value(&rules, contract, alone, team_points),
                                "breakdown": crate::score::breakdown(&rules, contract, alone, team_points),
                                "payoffs": settle(&rules, 0, friend, contract, call, team_points),
                            }));
                        }
                    }
                }
                serde_json::json!({ "name": name, "rules": rules, "hands": hands })
            })
            .collect();
        serde_json::Value::Array(sets)
    }

    /// Writes `tests/payoffs.json`; run by hand (`--ignored`) when the
    /// scoring is meant to change, then check the web client still agrees
    /// (`npm test` in web/).
    #[test]
    #[ignore]
    fn write_payoff_fixture() {
        let json = serde_json::to_string(&payoff_fixture()).unwrap();
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/payoffs.json"), json + "\n").unwrap();
    }

    /// The fixture the web client is tested against is what the engine
    /// pays today.
    #[test]
    fn payoffs_match_the_fixture() {
        let pinned: serde_json::Value =
            serde_json::from_str(include_str!("../tests/payoffs.json")).expect("the fixture parses");
        assert_eq!(pinned, payoff_fixture(), "scoring changed; rewrite tests/payoffs.json");
    }
}
