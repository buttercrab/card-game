use crate::card::{Card, Suit};
use crate::rules::{CardPolicy, Contract, InvalidRules, Rules};
use crate::trick::{self, Played, Trick, TrickContext};
use engine::{Seat, Turn};
use rand::RngCore;
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Options {
    pub rules: Rules,
    /// Usually the seat after the dealer.
    pub first_bidder: Seat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FriendCall {
    Card(Card),
    Seat(Seat),
    FirstTrick,
    LastTrick,
    Alone,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
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
    /// Declarer: put one card back, until as many as the kitty held.
    Discard(Card),
    CallFriend(FriendCall),
    /// `joker_suit` is the suit to follow when leading a joker.
    /// `call_joker` calls the joker when leading its joker-call card.
    Play {
        card: Card,
        joker_suit: Option<Suit>,
        call_joker: bool,
    },
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    pub(crate) rules: Rules,
    pub(crate) first_bidder: Seat,
    pub(crate) phase: Phase,
    /// Kept sorted.
    pub(crate) hands: Vec<Vec<Card>>,
    pub(crate) kitty: Vec<Card>,
    /// Every card each seat won in tricks.
    pub(crate) taken: Vec<Vec<Card>>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Exchange {
    pub declarer: Seat,
    pub contract: Contract,
    pub discards: Vec<Card>,
    pub trump_changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Play {
    pub declarer: Seat,
    pub contract: Contract,
    pub discards: Vec<Card>,
    pub call: FriendCall,
    /// Set once the friend is publicly known.
    pub friend: Option<Seat>,
    pub trick_no: usize,
    pub leader: Seat,
    pub lead: Option<Suit>,
    pub plays: Vec<Played>,
    /// The joker called this trick, if the call has effect.
    pub called_joker: Option<Card>,
    /// Completed tricks, oldest first.
    pub tricks: Vec<Trick>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Done {
    pub declarer: Seat,
    pub contract: Contract,
    pub discards: Vec<Card>,
    pub call: FriendCall,
    pub friend: Option<Seat>,
    pub team_points: u8,
    pub payoffs: Vec<i64>,
    pub tricks: Vec<Trick>,
}

impl State {
    pub(crate) fn new(options: &Options) -> Result<State, Error> {
        let rules = options.rules.clone();
        rules.validate()?;
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
        })
    }

    pub(crate) fn seats(&self) -> usize {
        self.rules.players
    }

    pub(crate) fn turn(&self) -> Turn {
        match &self.phase {
            Phase::Dealing => Turn::Chance,
            Phase::Bidding(b) => Turn::Seat(b.to_act),
            Phase::Exchange(e) => Turn::Seat(e.declarer),
            Phase::Play(p) => Turn::Seat((p.leader + p.plays.len()) % self.seats()),
            Phase::Done(_) => Turn::Over,
        }
    }

    pub(crate) fn sample_deal(&self, rng: &mut dyn RngCore) -> Action {
        let mut deck = self.rules.deck.cards();
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
        let mut deck = self.rules.deck.cards();
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

    fn redeal(&mut self) {
        for hand in &mut self.hands {
            hand.clear();
        }
        self.kitty.clear();
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

    fn legal_bids(&self, b: &Bidding) -> Vec<Action> {
        let bidding = &self.rules.bidding;
        let mut actions = Vec::new();
        if !b.has_bid[b.to_act] && self.rules.is_misdeal(&self.hands[b.to_act]) {
            actions.push(Action::Misdeal);
        }
        if b.best.is_some() || bidding.first_bidder_may_pass {
            actions.push(Action::Pass);
        }
        for trump in self.trump_options() {
            for count in 1..=bidding.max {
                let contract = Contract { trump, count };
                let rank = self.rules.bid_rank(contract);
                let beats_best = b.best.is_none_or(|(_, best)| rank > self.rules.bid_rank(best));
                if rank.0 >= bidding.min && beats_best {
                    actions.push(Action::Bid(contract));
                }
            }
        }
        actions
    }

    fn changed_contract(&self, contract: Contract, trump: Option<Suit>) -> Contract {
        let bonus = |t: Option<Suit>| {
            if t.is_none() {
                self.rules.bidding.no_trump_bonus
            } else {
                0
            }
        };
        let count = contract.count + self.rules.bidding.change_trump_cost + bonus(contract.trump);
        Contract {
            trump,
            count: count.saturating_sub(bonus(trump)),
        }
    }

    fn legal_exchange(&self, e: &Exchange) -> Vec<Action> {
        let hand = &self.hands[e.declarer];
        let mut actions = Vec::new();
        if e.discards.len() < self.rules.kitty_size() {
            if !e.trump_changed && e.discards.is_empty() {
                for trump in self.trump_options() {
                    let changed = self.changed_contract(e.contract, trump);
                    if trump != e.contract.trump && changed.count <= self.rules.bidding.max {
                        actions.push(Action::ChangeTrump(trump));
                    }
                }
            }
            actions.extend(hand.iter().map(|&c| Action::Discard(c)));
            return actions;
        }
        let f = &self.rules.friend;
        if f.by_card {
            for card in self.rules.deck.cards() {
                let own = hand.contains(&card) || e.discards.contains(&card);
                if !own || f.fake {
                    actions.push(Action::CallFriend(FriendCall::Card(card)));
                }
            }
        }
        if f.by_seat {
            let others = (0..self.seats()).filter(|&s| s != e.declarer);
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
        let hand = &self.hands[seat];
        let trump = p.contract.trump;
        let mighty = self.rules.mighty(trump);
        let policy = |c: &Card| self.rules.policy(*c, trump, p.trick_no);
        let leading = p.plays.is_empty();

        let cards: Vec<Card> = if leading {
            let allowed: Vec<Card> = hand
                .iter()
                .copied()
                .filter(|c| !matches!(policy(c), CardPolicy::Invalid | CardPolicy::NoLead))
                .collect();
            if allowed.is_empty() { hand.clone() } else { allowed }
        } else if let Some(joker) = p.called_joker.filter(|j| hand.contains(j)) {
            // A called joker must come out, rules above notwithstanding.
            let defend = self.rules.joker_call.mighty_defense && hand.contains(&mighty);
            std::iter::once(joker).chain(defend.then_some(mighty)).collect()
        } else {
            // The mighty and jokers may always be played and never oblige following.
            let lead = p.lead.expect("a trick in progress has a lead suit");
            let free = |c: &Card| *c == mighty || c.is_joker();
            let follows = hand.iter().any(|c| !free(c) && c.suit() == Some(lead));
            let candidates: Vec<Card> = hand
                .iter()
                .copied()
                .filter(|c| !follows || free(c) || c.suit() == Some(lead))
                .collect();
            // Held-back cards (such as trump on the first trick) may still
            // follow suit: a joker can name a suit that is otherwise held back.
            let allowed: Vec<Card> = candidates
                .iter()
                .copied()
                .filter(|c| policy(c) != CardPolicy::Invalid || (follows && !free(c)))
                .collect();
            if allowed.is_empty() { candidates } else { allowed }
        };

        let mut actions = Vec::new();
        for card in cards {
            let play = |joker_suit, call_joker| Action::Play {
                card,
                joker_suit,
                call_joker,
            };
            if leading && card.is_joker() {
                let two_jokers = self.rules.deck.jokers().len() > 1;
                for suit in Suit::ALL {
                    if !two_jokers || Some(suit.color()) == joker_color(card) {
                        actions.push(play(Some(suit), false));
                    }
                }
            } else {
                actions.push(play(None, false));
                if leading && self.can_call_joker(p, card) {
                    actions.push(play(None, true));
                }
            }
        }
        actions
    }

    /// The joker that leading `card` would call, if a call is possible now.
    fn callable_joker(&self, p: &Play, card: Card) -> Option<Card> {
        let call_policy = self.rules.on_trick(self.rules.policy.joker_call, p.trick_no);
        if call_policy != CardPolicy::Valid {
            return None;
        }
        self.rules.deck.jokers().iter().copied().find(|&joker| {
            let played = self.taken.iter().any(|t| t.contains(&joker));
            !played && self.rules.joker_call_card(joker, p.contract.trump) == Some(card)
        })
    }

    fn can_call_joker(&self, p: &Play, card: Card) -> bool {
        self.callable_joker(p, card).is_some()
    }

    /// Applies an action already known to be legal.
    pub(crate) fn step(&mut self, seat: Seat, action: Action) {
        let phase = std::mem::replace(&mut self.phase, Phase::Dealing);
        self.phase = match (phase, action) {
            (Phase::Bidding(_), Action::Misdeal) => {
                self.redeal();
                Phase::Dealing
            }
            (Phase::Bidding(b), action) => self.step_bidding(b, seat, action),
            (Phase::Exchange(e), action) => self.step_exchange(e, action),
            (
                Phase::Play(p),
                Action::Play {
                    card,
                    joker_suit,
                    call_joker,
                },
            ) => self.step_play(p, seat, card, joker_suit, call_joker),
            (phase, action) => unreachable!("legal action {action:?} in phase {phase:?}"),
        };
    }

    fn step_bidding(&mut self, mut b: Bidding, seat: Seat, action: Action) -> Phase {
        match action {
            Action::Pass => b.passed[seat] = true,
            Action::Bid(contract) => {
                b.best = Some((seat, contract));
                b.has_bid[seat] = true;
            }
            other => unreachable!("{other:?} while bidding"),
        }
        let active = b.passed.iter().filter(|p| !**p).count();
        match (active, b.best) {
            (0, _) => {
                self.redeal();
                Phase::Dealing
            }
            (1, Some((declarer, contract))) => {
                let kitty = std::mem::take(&mut self.kitty);
                self.hands[declarer].extend(kitty);
                self.hands[declarer].sort();
                Phase::Exchange(Exchange {
                    declarer,
                    contract,
                    discards: Vec::new(),
                    trump_changed: false,
                })
            }
            _ => {
                let n = self.seats();
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
                e.contract = self.changed_contract(e.contract, trump);
                e.trump_changed = true;
            }
            Action::Discard(card) => {
                let hand = &mut self.hands[e.declarer];
                hand.retain(|&c| c != card);
                e.discards.push(card);
            }
            Action::CallFriend(call) => {
                return Phase::Play(Play {
                    declarer: e.declarer,
                    contract: e.contract,
                    discards: e.discards,
                    call,
                    friend: match call {
                        FriendCall::Seat(s) => Some(s),
                        _ => None,
                    },
                    trick_no: 0,
                    leader: e.declarer,
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

    fn step_play(&mut self, mut p: Play, seat: Seat, card: Card, joker_suit: Option<Suit>, call: bool) -> Phase {
        self.hands[seat].retain(|&c| c != card);
        if p.plays.is_empty() {
            p.lead = if card.is_joker() { joker_suit } else { card.suit() };
            p.called_joker = if call { self.callable_joker(&p, card) } else { None };
        }
        let called_and_powerless = p.called_joker == Some(card) && !self.rules.joker_call.called_joker_has_power;
        let powered =
            self.rules.policy(card, p.contract.trump, p.trick_no) != CardPolicy::NoEffect && !called_and_powerless;
        p.plays.push(Played { seat, card, powered });
        if p.call == FriendCall::Card(card) && seat != p.declarer {
            p.friend = Some(seat);
        }
        if p.plays.len() < self.seats() {
            return Phase::Play(p);
        }

        let lead = p.lead.expect("a finished trick has a lead suit");
        let ctx = TrickContext {
            trump: p.contract.trump,
            mighty: self.rules.mighty(p.contract.trump),
            deck: self.rules.deck,
            lead,
        };
        let winner = p.plays[trick::winner(&ctx, &p.plays)].seat;
        self.taken[winner].extend(p.plays.iter().map(|pl| pl.card));
        let last = p.trick_no + 1 == self.rules.hand_size;
        let reveals = match p.call {
            FriendCall::FirstTrick => p.trick_no == 0,
            FriendCall::LastTrick => last,
            _ => false,
        };
        if reveals && winner != p.declarer && p.friend.is_none() {
            p.friend = Some(winner);
        }
        let plays = std::mem::take(&mut p.plays);
        p.tricks.push(Trick { plays, lead, winner });
        p.trick_no += 1;
        p.leader = winner;
        p.lead = None;
        p.called_joker = None;
        if last {
            Phase::Done(self.score(p))
        } else {
            Phase::Play(p)
        }
    }

    fn score(&self, p: Play) -> Done {
        let team = |s: Seat| s == p.declarer || Some(s) == p.friend;
        let won_points = (0..self.seats()).filter(|&s| team(s)).flat_map(|s| &self.taken[s]);
        let team_points = won_points.chain(&p.discards).filter(|c| c.is_point()).count() as u8;

        let count = p.contract.count;
        let value: i64 = if team_points >= count {
            let mut multiplier = 1;
            if p.contract.trump.is_none() {
                multiplier *= 2;
            }
            if p.call == FriendCall::Alone {
                multiplier *= 2;
            }
            if team_points == 20 {
                multiplier *= 2;
            }
            multiplier * (i64::from(team_points) - 10).max(1)
        } else {
            let short = i64::from(count - team_points);
            if team_points <= 10 { -2 * short } else { -short }
        };

        let opponents = (0..self.seats()).filter(|&s| !team(s)).count() as i64;
        let payoffs = (0..self.seats())
            .map(|s| {
                if s == p.declarer {
                    value * opponents - if p.friend.is_some() { value } else { 0 }
                } else if team(s) {
                    value
                } else {
                    -value
                }
            })
            .collect();
        Done {
            declarer: p.declarer,
            contract: p.contract,
            discards: p.discards,
            call: p.call,
            friend: p.friend,
            team_points,
            payoffs,
            tricks: p.tricks,
        }
    }

    pub(crate) fn discards(&self) -> Option<(&[Card], Seat)> {
        match &self.phase {
            Phase::Exchange(e) => Some((&e.discards, e.declarer)),
            Phase::Play(p) => Some((&p.discards, p.declarer)),
            Phase::Done(d) => Some((&d.discards, d.declarer)),
            Phase::Dealing | Phase::Bidding(_) => None,
        }
    }

    fn discards_mut(&mut self) -> Option<&mut Vec<Card>> {
        match &mut self.phase {
            Phase::Exchange(e) => Some(&mut e.discards),
            Phase::Play(p) => Some(&mut p.discards),
            Phase::Done(d) => Some(&mut d.discards),
            Phase::Dealing | Phase::Bidding(_) => None,
        }
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
        let sees_discards = self.discards().is_some_and(|(_, declarer)| Some(declarer) == me);
        let mut next = self.clone();

        let mut pool: Vec<Card> = Vec::new();
        for (s, hand) in next.hands.iter().enumerate() {
            if Some(s) != me {
                pool.extend(hand);
            }
        }
        pool.extend(&next.kitty);
        if !sees_discards {
            pool.extend(next.discards_mut().map(|d| d.clone()).unwrap_or_default());
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
        if !sees_discards && let Some(d) = next.discards_mut() {
            let n = d.len();
            *d = pool.drain(..n).collect();
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
        cards.extend(self.discards().map(|(d, _)| d.to_vec()).unwrap_or_default());
        if let Phase::Play(p) = &self.phase {
            cards.extend(p.plays.iter().map(|pl| pl.card));
        }
        let mut deck = self.rules.deck.cards();
        cards.sort();
        deck.sort();
        if cards != deck {
            return Err(format!("cards created or lost: have {} of {}", cards.len(), deck.len()));
        }

        match &self.phase {
            Phase::Bidding(_) => {
                if self.hands.iter().any(|h| h.len() != hand_size) {
                    return Err("hand size changed during bidding".into());
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
            }
            Phase::Dealing | Phase::Exchange(_) => {}
        }
        Ok(())
    }
}

fn joker_color(card: Card) -> Option<crate::card::Color> {
    match card {
        Card::Joker(color) => Some(color),
        Card::Normal(..) => None,
    }
}
