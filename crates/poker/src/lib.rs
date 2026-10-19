//! Independent play-chip Hold'em hands: 3–6 seats, fixed 1/2 blinds and stacks
//! of 1–200 chips. No persistent bankroll, rebuy, rake, tournament or heads-up rules.
mod rank;
mod table;
use engine::{Game, GameInfo, Preset, Seat, Turn, Viewer};
use rand::{RngCore, seq::SliceRandom};
pub use rank::{PokerHandCategory, PokerHandRank, rank};
use serde::{Deserialize, Serialize};
pub use table::{PokerBots, PokerCatalog, PokerNotes, PokerSettings, PokerSummary};
use ts_rs::TS;

pub const SMALL_BLIND: u16 = 1;
pub const BIG_BLIND: u16 = 2;
pub const MAX_STACK: u16 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PokerSuit {
    Clubs,
    Diamonds,
    Hearts,
    Spades,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PokerCard {
    pub rank: u8,
    pub suit: PokerSuit,
}
impl PokerCard {
    pub fn from_id(id: u8) -> Option<Self> {
        (id < 52).then(|| Self {
            rank: 2 + id % 13,
            suit: [
                PokerSuit::Clubs,
                PokerSuit::Diamonds,
                PokerSuit::Hearts,
                PokerSuit::Spades,
            ][id as usize / 13],
        })
    }
    pub fn id(self) -> Option<u8> {
        (2..=14).contains(&self.rank).then(|| {
            self.rank - 2
                + 13 * match self.suit {
                    PokerSuit::Clubs => 0,
                    PokerSuit::Diamonds => 1,
                    PokerSuit::Hearts => 2,
                    PokerSuit::Spades => 3,
                }
        })
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PokerRules {
    pub players: usize,
    pub starting_stack: u16,
}
impl Default for PokerRules {
    fn default() -> Self {
        Self {
            players: 3,
            starting_stack: 100,
        }
    }
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PokerOptions {
    pub rules: PokerRules,
    pub dealer: Seat,
    #[serde(default)]
    pub starting_stacks: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error, TS)]
pub enum PokerError {
    #[error("Hold'em requires 3 to 6 seats")]
    Players,
    #[error("Starting stacks must be integer chips from 1 to 200")]
    Stacks,
    #[error("Dealer must be a seat at the table")]
    Dealer,
    #[error("That action is not currently offered")]
    Action,
    #[error("A deal must contain each of the 52 cards exactly once")]
    Deck,
    #[error("Ranking requires five to seven distinct valid cards")]
    Cards,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PokerAction {
    Fold,
    Check,
    Call,
    RaiseTo {
        amount: u16,
    },
    AllIn,
    /// Private replay event; never appears in a player/spectator view or legal choices.
    Deal {
        deck: Vec<u8>,
    },
    Reveal,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PokerStreet {
    Preflop,
    Flop,
    Turn,
    River,
}
#[derive(Debug, Clone, PartialEq, Eq)]
struct Player {
    initial: u16,
    stack: u16,
    total: u16,
    bet: u16,
    folded: bool,
    acted_at: Option<u16>,
    pending: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Chance {
    Initial,
    Street,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PokerPot {
    pub amount: u16,
    pub winners: Vec<Seat>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PokerState {
    rules: PokerRules,
    dealer: Seat,
    players: Vec<Player>,
    street: PokerStreet,
    deck: Vec<u8>,
    holes: Vec<Vec<usize>>,
    board: Vec<usize>,
    burns: Vec<usize>,
    cursor: usize,
    chance: Option<Chance>,
    actor: Option<Seat>,
    current_bet: u16,
    last_full_raise: u16,
    over: bool,
    showdown: bool,
    /// All live hands are public once no further betting is possible.
    tabled: bool,
    pots: Vec<PokerPot>,
    refunds: Vec<u16>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PokerPlayerView {
    pub seat: Seat,
    pub stack: u16,
    pub contributed: u16,
    pub street_bet: u16,
    pub folded: bool,
    pub all_in: bool,
    pub hole_count: usize,
    pub hole: Option<Vec<PokerCard>>,
    pub shown: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PokerView {
    pub viewer: Option<Seat>,
    pub dealer: Seat,
    pub street: PokerStreet,
    pub actor: Option<Seat>,
    pub board: Vec<PokerCard>,
    pub players: Vec<PokerPlayerView>,
    pub pot: u16,
    pub current_bet: u16,
    pub min_raise_to: Option<u16>,
    pub showdown: bool,
    pub over: bool,
    pub pots: Vec<PokerPot>,
    pub refunds: Vec<u16>,
    pub payoffs: Option<Vec<i64>>,
}
#[derive(Debug, Clone, Copy)]
pub struct Poker;
impl GameInfo for Poker {
    type Rules = PokerRules;
    type RulesError = PokerError;
    const ID: &'static str = "poker";
    const NAME: &'static str = "텍사스 홀덤";
    fn presets() -> Vec<Preset<PokerRules>> {
        vec![Preset {
            id: "holdem",
            name: "플레이칩 홀덤",
            rules: PokerRules::default(),
        }]
    }
    fn validate(r: &PokerRules) -> Result<(), PokerError> {
        if !(3..=6).contains(&r.players) {
            Err(PokerError::Players)
        } else if !(1..=MAX_STACK).contains(&r.starting_stack) {
            Err(PokerError::Stacks)
        } else {
            Ok(())
        }
    }
    fn seats(r: &PokerRules) -> usize {
        r.players
    }
    fn describe(r: &PokerRules) -> String {
        format!("{} seats, {} play chips, blinds 1/2", r.players, r.starting_stack)
    }
}
impl Game for Poker {
    type Options = PokerOptions;
    type State = PokerState;
    type Action = PokerAction;
    type View = PokerView;
    type Error = PokerError;
    fn new_game(o: &PokerOptions) -> Result<PokerState, PokerError> {
        Self::validate(&o.rules)?;
        let n = o.rules.players;
        if o.dealer >= n {
            return Err(PokerError::Dealer);
        }
        let stacks = if o.starting_stacks.is_empty() {
            vec![o.rules.starting_stack; n]
        } else {
            o.starting_stacks.clone()
        };
        if stacks.len() != n || stacks.iter().any(|s| !(1..=MAX_STACK).contains(s)) {
            return Err(PokerError::Stacks);
        }
        Ok(PokerState {
            rules: o.rules.clone(),
            dealer: o.dealer,
            players: stacks
                .into_iter()
                .map(|s| Player {
                    initial: s,
                    stack: s,
                    total: 0,
                    bet: 0,
                    folded: false,
                    acted_at: None,
                    pending: false,
                })
                .collect(),
            street: PokerStreet::Preflop,
            deck: Vec::new(),
            holes: vec![Vec::new(); n],
            board: Vec::new(),
            burns: Vec::new(),
            cursor: 0,
            chance: Some(Chance::Initial),
            actor: None,
            current_bet: 0,
            last_full_raise: BIG_BLIND,
            over: false,
            showdown: false,
            tabled: false,
            pots: Vec::new(),
            refunds: vec![0; n],
        })
    }
    fn seat_count(s: &PokerState) -> usize {
        s.players.len()
    }
    fn turn(s: &PokerState) -> Turn {
        if s.over {
            Turn::Over
        } else if s.chance.is_some() {
            Turn::Chance
        } else {
            Turn::Seat(s.actor.expect("betting has an actor"))
        }
    }
    fn legal_actions(s: &PokerState, seat: Seat) -> Vec<PokerAction> {
        if s.over || s.chance.is_some() || s.actor != Some(seat) || seat >= s.players.len() {
            return vec![];
        }
        let p = &s.players[seat];
        let cost = s.call_cost(seat);
        let mut out = vec![PokerAction::Fold];
        out.push(if cost == 0 {
            PokerAction::Check
        } else {
            PokerAction::Call
        });
        if s.can_raise(seat) {
            let max = p.bet + p.stack;
            let min = s.current_bet + s.last_full_raise;
            if max >= min {
                out.extend((min..=max).map(|amount| PokerAction::RaiseTo { amount }));
            } else if max > s.current_bet {
                out.push(PokerAction::RaiseTo { amount: max });
            }
        }
        let max = p.bet + p.stack;
        if p.stack > 0 && (p.stack <= cost || s.can_raise(seat) && max > s.current_bet) {
            out.push(PokerAction::AllIn)
        }
        out
    }
    fn sample_chance(s: &PokerState, rng: &mut dyn RngCore) -> PokerAction {
        match s.chance {
            Some(Chance::Initial) => {
                let mut deck = (0..52).collect::<Vec<_>>();
                deck.shuffle(rng);
                PokerAction::Deal { deck }
            }
            Some(Chance::Street) => PokerAction::Reveal,
            None => panic!("chance requested outside chance turn"),
        }
    }
    fn apply_chance(s: &mut PokerState, action: PokerAction) -> Result<(), PokerError> {
        match (s.chance, action) {
            (Some(Chance::Initial), PokerAction::Deal { deck }) => {
                let mut sorted = deck.clone();
                sorted.sort_unstable();
                if sorted != (0..52).collect::<Vec<_>>() {
                    return Err(PokerError::Deck);
                }
                s.deck = deck;
                s.chance = None;
                for _ in 0..2 {
                    for step in 1..=s.players.len() {
                        let seat = (s.dealer + step) % s.players.len();
                        s.holes[seat].push(s.cursor);
                        s.cursor += 1;
                    }
                }
                s.pay((s.dealer + 1) % s.players.len(), SMALL_BLIND);
                s.pay((s.dealer + 2) % s.players.len(), BIG_BLIND);
                s.current_bet = BIG_BLIND;
                for p in &mut s.players {
                    p.pending = p.stack > 0;
                }
                s.progress((s.dealer + 2) % s.players.len());
                Ok(())
            }
            (Some(Chance::Street), PokerAction::Reveal) => {
                s.chance = None;
                s.burns.push(s.cursor);
                s.cursor += 1;
                let count = if s.street == PokerStreet::Preflop { 3 } else { 1 };
                for _ in 0..count {
                    s.board.push(s.cursor);
                    s.cursor += 1;
                }
                s.street = match s.street {
                    PokerStreet::Preflop => PokerStreet::Flop,
                    PokerStreet::Flop => PokerStreet::Turn,
                    PokerStreet::Turn => PokerStreet::River,
                    PokerStreet::River => unreachable!(),
                };
                s.current_bet = 0;
                s.last_full_raise = BIG_BLIND;
                for p in &mut s.players {
                    p.bet = 0;
                    p.acted_at = None;
                    p.pending = !p.folded && p.stack > 0;
                }
                s.progress(s.dealer);
                Ok(())
            }
            _ => Err(PokerError::Action),
        }
    }
    fn apply(s: &mut PokerState, seat: Seat, action: PokerAction) -> Result<(), PokerError> {
        if !Self::legal_actions(s, seat).contains(&action) {
            return Err(PokerError::Action);
        }
        let old = s.current_bet;
        match action {
            PokerAction::Fold => s.players[seat].folded = true,
            PokerAction::Check => {
                s.players[seat].acted_at = Some(old);
            }
            PokerAction::Call => {
                let cost = s.call_cost(seat);
                s.pay(seat, cost);
                s.players[seat].acted_at = Some(old);
            }
            PokerAction::RaiseTo { amount } => s.raise(seat, amount),
            PokerAction::AllIn => {
                let amount = s.players[seat].bet + s.players[seat].stack;
                if amount > old {
                    s.raise(seat, amount)
                } else {
                    let cost = s.players[seat].stack;
                    s.pay(seat, cost);
                    s.players[seat].acted_at = Some(old);
                }
            }
            _ => unreachable!("chance actions are never offered"),
        }
        s.players[seat].pending = false;
        s.progress(seat);
        Ok(())
    }
    fn view(s: &PokerState, viewer: Viewer) -> PokerView {
        let own = match viewer {
            Viewer::Seat(seat) if seat < s.players.len() => Some(seat),
            _ => None,
        };
        PokerView {
            viewer: own,
            dealer: s.dealer,
            street: s.street,
            actor: s.actor,
            board: s
                .board
                .iter()
                .map(|i| PokerCard::from_id(s.deck[*i]).unwrap())
                .collect(),
            players: s
                .players
                .iter()
                .enumerate()
                .map(|(seat, p)| {
                    let shown = s.tabled && !p.folded;
                    PokerPlayerView {
                        seat,
                        stack: p.stack,
                        contributed: p.total,
                        street_bet: p.bet,
                        folded: p.folded,
                        all_in: p.stack == 0 && !p.folded && !s.over,
                        hole_count: s.holes[seat].len(),
                        hole: (own == Some(seat) || shown).then(|| {
                            s.holes[seat]
                                .iter()
                                .map(|i| PokerCard::from_id(s.deck[*i]).unwrap())
                                .collect()
                        }),
                        shown,
                    }
                })
                .collect(),
            pot: if s.over {
                0
            } else {
                s.players.iter().map(|p| p.total).sum()
            },
            current_bet: s.current_bet,
            min_raise_to: own
                .filter(|seat| s.actor == Some(*seat))
                .and_then(|seat| s.min_raise_to(seat)),
            showdown: s.showdown,
            over: s.over,
            pots: s.pots.clone(),
            refunds: s.refunds.clone(),
            payoffs: Self::payoffs(s),
        }
    }
    fn payoffs(s: &PokerState) -> Option<Vec<i64>> {
        s.over.then(|| {
            s.players
                .iter()
                .map(|p| i64::from(p.stack) - i64::from(p.initial))
                .collect()
        })
    }
    fn reshuffle_hidden(s: &PokerState, viewer: Viewer, rng: &mut dyn RngCore) -> PokerState {
        let mut next = s.clone();
        if next.deck.is_empty() {
            return next;
        }
        let own = match viewer {
            Viewer::Seat(seat) => Some(seat),
            Viewer::Spectator => None,
        };
        let mut known = s.board.clone();
        for (seat, p) in s.players.iter().enumerate() {
            if own == Some(seat) || s.tabled && !p.folded {
                known.extend(&s.holes[seat]);
            }
        }
        let hidden: Vec<_> = (0..52).filter(|i| !known.contains(i)).collect();
        let mut cards: Vec<_> = hidden.iter().map(|i| s.deck[*i]).collect();
        cards.shuffle(rng);
        for (i, card) in hidden.into_iter().zip(cards) {
            next.deck[i] = card
        }
        next
    }
    fn check_invariants(s: &PokerState) -> Result<(), String> {
        let sum: u16 = s
            .players
            .iter()
            .map(|p| p.stack + if s.over { 0 } else { p.total })
            .sum();
        let initial: u16 = s.players.iter().map(|p| p.initial).sum();
        if sum != initial {
            return Err(format!("chip conservation: {sum} != {initial}"));
        }
        if s.players.iter().any(|p| p.bet > p.total || p.stack > initial) {
            return Err("invalid chip accounting".into());
        }
        if !s.deck.is_empty() {
            let mut sorted = s.deck.clone();
            sorted.sort_unstable();
            if sorted != (0..52).collect::<Vec<_>>() {
                return Err("invalid deck".into());
            }
            let mut positions = s.holes.iter().flatten().copied().collect::<Vec<_>>();
            positions.extend(&s.board);
            positions.extend(&s.burns);
            positions.sort_unstable();
            if positions != (0..s.cursor).collect::<Vec<_>>() {
                return Err("invalid deal positions".into());
            }
        }
        if !s.over && s.chance.is_none() && s.actor.is_none() {
            return Err("missing actor".into());
        }
        Ok(())
    }
}
impl PokerState {
    fn pay(&mut self, seat: Seat, amount: u16) {
        let p = &mut self.players[seat];
        let paid = amount.min(p.stack);
        p.stack -= paid;
        p.total += paid;
        p.bet += paid;
    }
    fn call_cost(&self, seat: Seat) -> u16 {
        let contest = self
            .players
            .iter()
            .enumerate()
            .filter(|(other, p)| *other != seat && !p.folded)
            .map(|(_, p)| p.bet + p.stack)
            .max()
            .unwrap_or(0);
        self.current_bet
            .min(contest)
            .saturating_sub(self.players[seat].bet)
            .min(self.players[seat].stack)
    }
    // TDA rule 49: a player who already acted must face a full raise in
    // aggregate. This includes a check before a short opening all-in.
    fn can_raise(&self, seat: Seat) -> bool {
        let p = &self.players[seat];
        !p.folded
            && p.stack > 0
            && p.bet + p.stack > self.current_bet
            && self
                .players
                .iter()
                .enumerate()
                .any(|(other, q)| other != seat && !q.folded && q.stack > 0)
            && (p.acted_at.is_none() || self.current_bet.saturating_sub(p.acted_at.unwrap()) >= self.last_full_raise)
    }
    fn min_raise_to(&self, seat: Seat) -> Option<u16> {
        self.can_raise(seat)
            .then(|| (self.current_bet + self.last_full_raise).min(self.players[seat].bet + self.players[seat].stack))
    }
    fn raise(&mut self, seat: Seat, amount: u16) {
        let delta = amount - self.current_bet;
        if delta >= self.last_full_raise {
            self.last_full_raise = delta
        }
        let paid = amount - self.players[seat].bet;
        self.pay(seat, paid);
        self.current_bet = amount;
        self.players[seat].acted_at = Some(amount);
        for (other, p) in self.players.iter_mut().enumerate() {
            if other != seat && !p.folded && p.stack > 0 && p.bet < amount {
                p.pending = true;
            }
        }
    }
    fn progress(&mut self, after: Seat) {
        let live: Vec<_> = self
            .players
            .iter()
            .enumerate()
            .filter(|(_, p)| !p.folded)
            .map(|(i, _)| i)
            .collect();
        if live.len() == 1 {
            self.refund_uncalled();
            let pot = self.players.iter().map(|p| p.total).sum();
            self.players[live[0]].stack += pot;
            self.pots.push(PokerPot {
                amount: pot,
                winners: live,
            });
            self.finish();
            return;
        }
        let active: Vec<_> = live
            .iter()
            .copied()
            .filter(|seat| self.players[*seat].stack > 0)
            .collect();
        for p in &mut self.players {
            if p.folded || p.stack == 0 {
                p.pending = false
            }
        }
        if active.len() == 1 && self.call_cost(active[0]) == 0 {
            self.players[active[0]].pending = false;
        }
        for step in 1..=self.players.len() {
            let seat = (after + step) % self.players.len();
            if self.players[seat].pending {
                self.actor = Some(seat);
                return;
            }
        }
        self.refund_uncalled();
        // Outstanding calls/folds have resolved. With at most one player who
        // still has chips, no future side-pot betting can occur: table the live
        // hands now, while board chance events and pot settlement remain pending.
        if active.len() <= 1 {
            self.tabled = true;
        }
        self.actor = None;
        if self.street == PokerStreet::River {
            self.showdown();
        } else {
            self.chance = Some(Chance::Street)
        }
    }
    fn refund_uncalled(&mut self) {
        let mut order: Vec<_> = (0..self.players.len()).collect();
        order.sort_unstable_by_key(|seat| std::cmp::Reverse(self.players[*seat].bet));
        let seat = order[0];
        let amount = self.players[seat].bet - self.players[order[1]].bet;
        if amount > 0 && !self.players[seat].folded {
            self.players[seat].bet -= amount;
            self.players[seat].total -= amount;
            self.players[seat].stack += amount;
            self.refunds[seat] += amount;
        }
        self.current_bet = self.players.iter().map(|player| player.bet).max().unwrap_or(0);
    }
    fn showdown(&mut self) {
        self.showdown = true;
        self.tabled = true;
        let ranks: Vec<_> = self
            .players
            .iter()
            .enumerate()
            .map(|(seat, p)| {
                (!p.folded).then(|| {
                    let cards: Vec<_> = self.holes[seat]
                        .iter()
                        .chain(&self.board)
                        .map(|i| PokerCard::from_id(self.deck[*i]).unwrap())
                        .collect();
                    rank(&cards).unwrap()
                })
            })
            .collect();
        let mut levels: Vec<_> = self.players.iter().filter(|p| p.total > 0).map(|p| p.total).collect();
        levels.sort_unstable();
        levels.dedup();
        let mut previous = 0;
        for level in levels {
            let contributors: Vec<_> = self
                .players
                .iter()
                .enumerate()
                .filter(|(_, p)| p.total >= level)
                .map(|(i, _)| i)
                .collect();
            let amount = (level - previous) * contributors.len() as u16;
            previous = level;
            let eligible: Vec<_> = contributors
                .iter()
                .copied()
                .filter(|seat| !self.players[*seat].folded)
                .collect();
            let best = eligible
                .iter()
                .map(|seat| ranks[*seat].as_ref().unwrap())
                .max()
                .expect("a contested pot has a live contributor");
            let mut winners: Vec<_> = eligible
                .into_iter()
                .filter(|seat| ranks[*seat].as_ref() == Some(best))
                .collect();
            winners.sort_unstable_by_key(|seat| (*seat + self.players.len() - self.dealer - 1) % self.players.len());
            for (i, seat) in winners.iter().enumerate() {
                self.players[*seat].stack +=
                    amount / winners.len() as u16 + u16::from(i < amount as usize % winners.len());
            }
            self.pots.push(PokerPot { amount, winners });
        }
        self.finish();
    }
    fn finish(&mut self) {
        self.over = true;
        self.actor = None;
        self.chance = None;
        for p in &mut self.players {
            p.pending = false
        }
    }
}

#[cfg(test)]
mod tests;
