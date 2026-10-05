//! Mighty positions as model inputs ([`engine::Encode`]).
//!
//! One layout covers every rule set the engine accepts (up to
//! [`MAX_SEATS`] players, either deck, any `lowest_rank` and
//! `extra_cards`), so one model plays them all:
//!
//! - **Seats** are relative to the viewer: 0 is the viewer, 1 the next to
//!   play, and so on. Per-seat features have [`MAX_SEATS`] entries, with a
//!   `present` mask for the seats this table has.
//! - **Cards** have one row per card of the largest deck ([`SLOTS`]: four
//!   suits of 2 to A, then the black and the red joker), with an `in_deck`
//!   mask for the cards this rule set deals. A row says what the card
//!   means now, as the engine works it out (point, mighty, trump,
//!   joker-call card, policy on the first and last trick, power in the
//!   trick under way, whether it would win it, whether it may be played)
//!   and where the viewer knows it to be (my hand, the trick under way and
//!   who played it, earlier tricks and who played and won them, discards
//!   the viewer may see, or unseen).
//! - **Events** are everything said or played this deal that the viewer
//!   saw, oldest first, at most [`MAX_EVENTS`] (the oldest are dropped
//!   past that; the card rows still say where every played card went).
//! - **Actions** have a fixed index each ([`ACTIONS`] in all); see
//!   [`action_index`].
//!
//! The rules also go in whole as a global vector, but the per-card
//! meanings carry most of what a rule changes, which is what lets a model
//! play rule combinations it never trained on.

pub use crate::card::SLOTS;
use crate::card::{ACE, Card, Color, Suit};
use crate::rules::{
    BackRun, CardPolicy, Contract, Doubling, LoseScore, MAX_PLAYERS, MisdealWindow, NextDealer, Rules, TrickPolicy,
    WinScore,
};
use crate::state::{Action, Bid, FriendCall, Phase, TrickState, powered};
use crate::trick::{self, Lead, PlainSuit, Played, Trick, TrickContext, plain_suit, power};
use crate::view::{PhaseView, View};
use crate::{Mighty, Options, State};
use engine::{Encode, Features, Game, Observation, Seat, Spec, Unsupported, Viewer};

/// Names this encoding in data and models. Change it with any change to
/// the layout or to what a feature means; `tests/encoding.json` pins the
/// spec so that cannot happen unnoticed. `mighty-2` (2026-10-05) added
/// how a failed contract is scored (`rules.scoring.lose`); models trained
/// on `mighty-1` cannot read it. `mighty-3` (2026-10-05) dropped the
/// misdeal round (`phase=misdeal_round`, `kind=no_misdeal`): a misdeal is
/// called from the moment the cards land, so there is no round to show.
/// `mighty-4` (2026-10-06) says when a misdeal may be called as one
/// `rules.misdeal.window` instead of the `after_bidding` and `ask_first`
/// flags.
pub const VERSION: &str = "mighty-4";

/// Every encoding version and the fingerprint of the spec it stands for
/// (FNV-1a, 64 bits, of the spec's JSON with `version` left empty), oldest
/// first. Append a line with each new `VERSION`; never edit one. A test
/// (`tests/encode.rs`) fails when the spec no longer matches the last line,
/// so a spec cannot change without a new version.
pub const SPECS: &[(&str, u64)] = &[("mighty-3", 0x34b5_0ba5_4929_610f), ("mighty-4", 0xea61_3429_37b6_0266)];

/// The most players any rule set may seat: per-seat features have room
/// for this many.
pub const MAX_SEATS: usize = MAX_PLAYERS;

/// The highest contract number the action space has room for. The rule
/// editor stops at 26; [`Encode::spec`] refuses rules above this.
pub const MAX_COUNT: u8 = 30;

/// Event rows. A hand of 기본 needs about 80; long bidding without final
/// passes needs more.
pub const MAX_EVENTS: usize = 160;

/// Where a hidden card can be, by [`Encode::belief_targets`] index: a
/// relative seat's hand, or face down off the table (the kitty before the
/// exchange, the discards after).
pub const BURIED: i32 = MAX_SEATS as i32;

// The action space, block by block.
const TRUMPS: usize = 5;
const COUNTS: usize = MAX_COUNT as usize;
const LEADS: usize = 6;
const PASS: usize = 0;
const MISDEAL: usize = 1;
const BID: usize = 2;
const CHANGE: usize = BID + TRUMPS * COUNTS;
const RAISE: usize = CHANGE + TRUMPS;
const DISCARD: usize = RAISE + TRUMPS * COUNTS;
const CALL_CARD: usize = DISCARD + SLOTS;
const CALL_SEAT: usize = CALL_CARD + SLOTS;
const CALL_FIRST: usize = CALL_SEAT + MAX_SEATS;
const CALL_LAST: usize = CALL_FIRST + 1;
const CALL_ALONE: usize = CALL_LAST + 1;
const PLAY: usize = CALL_ALONE + 1;
const PLAY_CALL: usize = PLAY + SLOTS;
const JOKER_LEAD: usize = PLAY_CALL + SLOTS;

/// How many action indices there are.
pub const ACTIONS: usize = JOKER_LEAD + 2 * LEADS;

/// Points in a deck, for scaling counts of points and contracts.
const POINTS: f32 = 20.0;

const TRUMP_LABELS: [&str; TRUMPS] = ["♠", "♦", "♥", "♣", "nt"];
const LEAD_LABELS: [&str; LEADS] = ["♠", "♦", "♥", "♣", "black", "red"];
const POLICY_LABELS: [&str; 4] = ["valid", "no_effect", "invalid", "no_lead"];
const DOUBLING_LABELS: [&str; 3] = ["never", "win", "always"];
const CALL_LABELS: [&str; 5] = ["card", "seat", "first_trick", "last_trick", "alone"];
const PHASE_LABELS: [&str; 5] = ["dealing", "bidding", "exchange", "play", "done"];
const BIDDING: usize = 1;
// Event kinds, by their index in `EVENT_LABELS`.
const PASSED: usize = 0;
const BID_MADE: usize = 1;
const CONTRACT_SET: usize = 2;
const DISCARDED: usize = 3;
const CALLED: usize = 4;
const PLAYED: usize = 5;
const TRICK_DONE: usize = 6;
const EVENT_LABELS: [&str; 7] = ["pass", "bid", "contract", "discard", "call", "play", "trick"];

fn trump_index(trump: Option<Suit>) -> usize {
    trump.map_or(4, |suit| suit as usize)
}

fn lead_index(lead: Lead) -> usize {
    match lead {
        Lead::Suit(suit) => suit as usize,
        Lead::Color(color) => 4 + color as usize,
    }
}

fn contract_index(contract: Contract) -> Option<usize> {
    let count = usize::from(contract.count);
    (1..=COUNTS)
        .contains(&count)
        .then(|| trump_index(contract.trump) * COUNTS + count - 1)
}

fn policy_index(policy: CardPolicy) -> usize {
    match policy {
        CardPolicy::Valid => 0,
        CardPolicy::NoEffect => 1,
        CardPolicy::Invalid => 2,
        CardPolicy::NoLead => 3,
    }
}

fn doubling_index(doubling: Doubling) -> usize {
    match doubling {
        Doubling::Never => 0,
        Doubling::Win => 1,
        Doubling::Always => 2,
    }
}

fn call_index(call: FriendCall) -> usize {
    match call {
        FriendCall::Card(_) => 0,
        FriendCall::Seat(_) => 1,
        FriendCall::FirstTrick => 2,
        FriendCall::LastTrick => 3,
        FriendCall::Alone => 4,
    }
}

/// `seat` as the seat `me` sees it: 0 is `me`, 1 plays next.
fn relative(me: Seat, seat: Seat, players: usize) -> usize {
    (seat + players - me) % players
}

/// The fixed index of `action` taken by seat `me` at a table of `players`;
/// `None` for a deal or a contract above [`MAX_COUNT`].
///
/// Layout: pass, misdeal, bids (trump × number), trump changes, raises
/// (trump × number), discards (by card), friend calls (by card, by
/// relative seat, first trick, last trick, alone), plays (by card),
/// plays calling the joker (by card), joker leads (joker × suit or
/// colour named).
pub fn action_index(me: Seat, players: usize, action: &Action) -> Option<usize> {
    Some(match *action {
        Action::Deal { .. } => return None,
        Action::Pass => PASS,
        Action::Misdeal => MISDEAL,
        Action::Bid(contract) => BID + contract_index(contract)?,
        Action::ChangeTrump(trump) => CHANGE + trump_index(trump),
        Action::Raise(contract) => RAISE + contract_index(contract)?,
        Action::Discard(card) => DISCARD + card.slot(),
        Action::CallFriend(FriendCall::Card(card)) => CALL_CARD + card.slot(),
        Action::CallFriend(FriendCall::Seat(seat)) => CALL_SEAT + relative(me, seat, players),
        Action::CallFriend(FriendCall::FirstTrick) => CALL_FIRST,
        Action::CallFriend(FriendCall::LastTrick) => CALL_LAST,
        Action::CallFriend(FriendCall::Alone) => CALL_ALONE,
        Action::Play {
            card: Card::Joker(color),
            joker_lead: Some(lead),
            ..
        } => JOKER_LEAD + color as usize * LEADS + lead_index(lead),
        Action::Play {
            card, call_joker: true, ..
        } => PLAY_CALL + card.slot(),
        Action::Play { card, .. } => PLAY + card.slot(),
    })
}

/// A readable name for every action index, for the spec.
fn action_name(index: usize) -> String {
    let contract = |i: usize| format!("{}{}", TRUMP_LABELS[i / COUNTS], i % COUNTS + 1);
    let card = |i: usize| Card::from_slot(i).to_string();
    match index {
        PASS => "pass".into(),
        MISDEAL => "misdeal".into(),
        i if i < CHANGE => format!("bid {}", contract(i - BID)),
        i if i < RAISE => format!("change trump {}", TRUMP_LABELS[i - CHANGE]),
        i if i < DISCARD => format!("raise {}", contract(i - RAISE)),
        i if i < CALL_CARD => format!("discard {}", card(i - DISCARD)),
        i if i < CALL_SEAT => format!("call {}", card(i - CALL_CARD)),
        i if i < CALL_FIRST => format!("call seat+{}", i - CALL_SEAT),
        CALL_FIRST => "call first trick".into(),
        CALL_LAST => "call last trick".into(),
        CALL_ALONE => "call alone".into(),
        i if i < PLAY_CALL => format!("play {}", card(i - PLAY)),
        i if i < JOKER_LEAD => format!("play {} calling the joker", card(i - PLAY_CALL)),
        i => {
            let i = i - JOKER_LEAD;
            format!("lead {} as {}", card(52 + i / LEADS), LEAD_LABELS[i % LEADS])
        }
    }
}

/// Where the viewer knows a card to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Place {
    /// Not dealt under these rules.
    Absent,
    Mine,
    /// In the trick under way, played by this absolute seat.
    Trick(Seat),
    /// In finished trick number `trick`.
    Played {
        trick: usize,
        by: Seat,
        won_by: Seat,
        led: bool,
    },
    /// Among the discards, which this viewer may see.
    Discarded,
    /// In another hand, the kitty or discards the viewer may not see.
    Unseen,
}

/// What a view says, gathered once per position.
struct Table<'a> {
    view: &'a View,
    rules: &'a Rules,
    me: Seat,
    players: usize,
    /// The contract once the bidding is over.
    contract: Option<Contract>,
    /// The bid to beat while bidding.
    best: Option<(Seat, Contract)>,
    /// What decides the cards' roles: the contract's trump, else the best
    /// bid's, else none.
    trump: Option<Suit>,
    declarer: Option<Seat>,
    friend: Option<Seat>,
    call: Option<FriendCall>,
    to_act: Option<Seat>,
    leader: Option<Seat>,
    trick_no: usize,
    lead: Option<Lead>,
    plays: &'a [Played],
    called_joker: Option<Card>,
    tricks: &'a [Trick],
    /// The discards, when this viewer may see them.
    discards: &'a [Card],
    places: [Place; SLOTS],
}

impl<'a> Table<'a> {
    fn new(view: &'a View) -> Table<'a> {
        let rules = &view.rules;
        let players = rules.players;
        let me = match view.viewer {
            Viewer::Seat(seat) => seat,
            Viewer::Spectator => 0,
        };
        let mut t = Table {
            view,
            rules,
            me,
            players,
            contract: None,
            best: None,
            trump: None,
            declarer: None,
            friend: None,
            call: None,
            to_act: None,
            leader: None,
            trick_no: 0,
            lead: None,
            plays: &[],
            called_joker: None,
            tricks: &[],
            discards: &[],
            places: [Place::Absent; SLOTS],
        };
        match &view.phase {
            PhaseView::Dealing => {}
            PhaseView::Bidding { to_act, best, .. } => {
                t.to_act = Some(*to_act);
                t.best = *best;
                t.trump = best.and_then(|(_, c)| c.trump);
            }
            PhaseView::Exchange {
                declarer,
                contract,
                discards,
                ..
            } => {
                t.settle(*declarer, *contract);
                t.to_act = Some(*declarer);
                t.discards = discards.as_deref().unwrap_or_default();
            }
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
                ..
            } => {
                t.settle(*declarer, *contract);
                t.call = Some(*call);
                t.friend = *friend;
                t.trick_no = *trick_no;
                t.leader = Some(*leader);
                t.to_act = Some((leader + plays.len()) % players);
                t.lead = *lead;
                t.plays = plays;
                t.called_joker = *called_joker;
                t.tricks = tricks;
                t.discards = discards.as_deref().unwrap_or_default();
            }
            PhaseView::Done {
                declarer,
                contract,
                call,
                friend,
                tricks,
                discards,
                ..
            } => {
                t.settle(*declarer, *contract);
                t.call = Some(*call);
                t.friend = *friend;
                t.trick_no = tricks.len();
                t.tricks = tricks;
                t.discards = discards;
            }
        }
        t.places = t.places();
        t
    }

    fn settle(&mut self, declarer: Seat, contract: Contract) {
        self.declarer = Some(declarer);
        self.contract = Some(contract);
        self.trump = contract.trump;
    }

    fn places(&self) -> [Place; SLOTS] {
        let mut places = [Place::Absent; SLOTS];
        for card in self.rules.cards() {
            places[card.slot()] = Place::Unseen;
        }
        for &card in &self.view.hand {
            places[card.slot()] = Place::Mine;
        }
        for &card in self.discards {
            places[card.slot()] = Place::Discarded;
        }
        for (trick, t) in self.tricks.iter().enumerate() {
            for (i, p) in t.plays.iter().enumerate() {
                places[p.card.slot()] = Place::Played {
                    trick,
                    by: p.seat,
                    won_by: t.winner,
                    led: i == 0,
                };
            }
        }
        for p in self.plays {
            places[p.card.slot()] = Place::Trick(p.seat);
        }
        places
    }

    fn rel(&self, seat: Seat) -> usize {
        relative(self.me, seat, self.players)
    }

    /// Cards that may still be played, as far as the viewer knows: in my
    /// hand or unseen (unseen discards included, since nobody can tell them
    /// apart from cards in hands).
    fn live(&self, card: Card) -> bool {
        matches!(self.places[card.slot()], Place::Mine | Place::Unseen)
    }

    /// Whether `joker` was won in a finished trick, which ends calling it.
    fn gone(&self, joker: Card) -> bool {
        matches!(self.places[joker.slot()], Place::Played { .. })
    }

    /// The trick whose policies apply: the one under way, or a middle one
    /// (no first- or last-trick rules) outside the play.
    fn policy_trick(&self) -> usize {
        match self.view.phase {
            PhaseView::Play { trick_no, .. } => trick_no,
            _ => usize::from(self.rules.hand_size > 2),
        }
    }

    fn trick_state(&self, lead: Option<Lead>) -> TrickState {
        TrickState {
            trump: self.trump,
            trick_no: self.policy_trick(),
            lead,
            called_joker: self.called_joker,
        }
    }

    fn context(&self, lead: Lead) -> TrickContext {
        self.rules.trick_context(self.trump, lead)
    }

    /// Each live card's power in the trick under way, or as a lead when
    /// none is: the share of the other live cards that would not beat it
    /// if played after it. 1 is unbeatable; 0 for cards already played.
    ///
    /// Who beats whom in a two-card trick is an order on [`power`] keys
    /// once the lead and the winning plain suit are fixed, and those take
    /// only a few values, so each card's count is a binary search among
    /// the keys of its group instead of a trick played against every other
    /// card. `tests::strengths_match_two_card_tricks` checks the two agree.
    fn strengths(&self) -> [f32; SLOTS] {
        // Power does not depend on the lead, so each card's is worked out once.
        let live = self.live_played();
        let others = live.len().saturating_sub(1);
        // Sorted keys of every live card, by (lead, winning suit).
        let mut groups: Vec<(Lead, PlainSuit, Vec<u16>)> = Vec::new();
        let mut strengths = [0.0; SLOTS];
        for first in &live {
            let lead = self.lead.unwrap_or_else(|| natural_lead(first.card));
            let ctx = self.context(lead);
            let suit = plain_suit(&ctx, first);
            let keys = match groups.iter().position(|&(l, s, _)| l == lead && s == suit) {
                Some(i) => &groups[i].2,
                None => {
                    let mut keys: Vec<u16> = live.iter().map(|p| power(&ctx, suit, p)).collect();
                    keys.sort_unstable();
                    groups.push((lead, suit, keys));
                    &groups[groups.len() - 1].2
                }
            };
            let mine = power(&ctx, suit, first);
            let beaten = keys.len() - keys.partition_point(|&k| k <= mine);
            strengths[first.card.slot()] = if others == 0 {
                1.0
            } else {
                1.0 - beaten as f32 / others as f32
            };
        }
        strengths
    }

    /// Every live card as played into the trick under way.
    fn live_played(&self) -> Vec<Played> {
        let t = self.trick_state(self.lead);
        (0..SLOTS)
            .map(Card::from_slot)
            .filter(|&card| self.live(card))
            .map(|card| Played {
                seat: 0,
                card,
                powered: powered(self.rules, t, card),
            })
            .collect()
    }

    /// Whether `card`, played now, would be winning the trick under way.
    /// `plays` is scratch space, reused across cards.
    fn would_win(&self, card: Card, plays: &mut Vec<Played>) -> bool {
        let Some(lead) = self.lead.filter(|_| !self.plays.is_empty()) else {
            // Leading: the first card is the trick so far.
            return true;
        };
        plays.clear();
        plays.extend_from_slice(self.plays);
        plays.push(Played {
            seat: self.me,
            card,
            powered: powered(self.rules, self.trick_state(Some(lead)), card),
        });

        trick::winner(&self.context(lead), plays) == plays.len() - 1
    }
}

/// What a card sets when it is led: its suit, or, for a joker, its colour
/// (a joker leads a suit of its own colour wherever that matters).
fn natural_lead(card: Card) -> Lead {
    match card {
        Card::Normal(suit, _) => Lead::Suit(suit),
        Card::Joker(color) => Lead::Color(color),
    }
}

fn global(f: &mut Features, t: &Table) {
    rules_features(f, t.rules);

    let view = t.view;
    let phase = match &view.phase {
        PhaseView::Dealing => 0,
        PhaseView::Bidding { .. } => BIDDING,
        PhaseView::Exchange { .. } => 2,
        PhaseView::Play { .. } => 3,
        PhaseView::Done { .. } => 4,
    };
    f.one_hot("phase", &PHASE_LABELS, Some(phase));
    f.flag("spectator", view.viewer == Viewer::Spectator);
    let redealt = view.redealt.as_ref();
    f.num("redeals", redealt.map_or(0.0, |r| r.count.min(4) as f32 / 4.0));
    f.flag(
        "redealt.misdeal",
        redealt.is_some_and(|r| matches!(r.why, crate::Redeal::Misdeal { .. })),
    );
    f.flag(
        "redealt.all_passed",
        redealt.is_some_and(|r| r.why == crate::Redeal::AllPassed),
    );
    let last_chance = t.rules.bidding.last_chance_min.is_some()
        && phase == BIDDING
        && t.best.is_none()
        && view.bids.len() == t.players;
    f.flag("last_chance", last_chance);

    let best = t.best.map(|(_, c)| c);
    f.flag("best_bid", best.is_some());
    contract_features(f, "best_bid", t.rules, best);
    f.flag("contract", t.contract.is_some());
    contract_features(f, "contract", t.rules, t.contract);
    let changed = match &view.phase {
        PhaseView::Exchange { trump_changed, .. } => *trump_changed,
        _ => t.contract.is_some() && t.contract != winning_bid(&view.bids),
    };
    f.flag("contract_changed", changed);

    f.one_hot("call", &CALL_LABELS, t.call.map(call_index));
    f.flag("friend_known", t.friend.is_some());
    f.num("trick", t.trick_no as f32 / t.rules.hand_size as f32);
    f.num("cards_in_trick", t.plays.len() as f32 / t.players as f32);
    f.one_hot("lead", &LEAD_LABELS, t.lead.map(lead_index));
    f.flag("joker_called", t.called_joker.is_some());
    let team_points = match &view.phase {
        PhaseView::Done { team_points, .. } => f32::from(*team_points),
        _ => 0.0,
    };
    f.num("team_points", team_points / POINTS);

    // Per relative seat; seats past the table's are all zero.
    let n = t.players;
    let at = |k: usize| (k < n).then(|| (t.me + k) % n);
    let seat_flag = |k: usize, test: &dyn Fn(Seat) -> bool| at(k).map_or(0.0, |s| f32::from(u8::from(test(s))));
    let bidding = match &view.phase {
        PhaseView::Bidding { passed, has_bid, .. } => Some((passed, has_bid)),
        _ => None,
    };
    f.each("seat.present", MAX_SEATS, |k| seat_flag(k, &|_| true));
    f.each("seat.to_act", MAX_SEATS, |k| seat_flag(k, &|s| t.to_act == Some(s)));
    f.each("seat.first_bidder", MAX_SEATS, |k| {
        seat_flag(k, &|s| view.first_bidder == s)
    });
    f.each("seat.passed", MAX_SEATS, |k| {
        seat_flag(k, &|s| bidding.is_some_and(|(passed, _)| passed[s]))
    });
    f.each("seat.has_bid", MAX_SEATS, |k| {
        seat_flag(k, &|s| bidding.is_some_and(|(_, has_bid)| has_bid[s]))
    });
    f.each("seat.best_bidder", MAX_SEATS, |k| {
        seat_flag(k, &|s| t.best.is_some_and(|(b, _)| b == s))
    });
    f.each("seat.declarer", MAX_SEATS, |k| seat_flag(k, &|s| t.declarer == Some(s)));
    f.each("seat.friend", MAX_SEATS, |k| seat_flag(k, &|s| t.friend == Some(s)));
    f.each("seat.leader", MAX_SEATS, |k| seat_flag(k, &|s| t.leader == Some(s)));
    f.each("seat.hand_size", MAX_SEATS, |k| {
        at(k).map_or(0.0, |s| {
            view.hand_sizes.get(s).copied().unwrap_or(0) as f32 / t.rules.hand_size as f32
        })
    });
    f.each("seat.points", MAX_SEATS, |k| {
        at(k).map_or(0.0, |s| view.points_taken.get(s).map_or(0, Vec::len) as f32 / POINTS)
    });
}

/// The contract the bidding ended on: its last bid.
fn winning_bid(bids: &[Bid]) -> Option<Contract> {
    bids.iter().rev().find_map(|b| b.contract)
}

fn contract_features(f: &mut Features, name: &str, rules: &Rules, contract: Option<Contract>) {
    f.one_hot(
        &format!("{name}.trump"),
        &TRUMP_LABELS,
        contract.map(|c| trump_index(c.trump)),
    );
    f.num(
        &format!("{name}.count"),
        contract.map_or(0.0, |c| f32::from(c.count) / POINTS),
    );
    f.num(
        &format!("{name}.value"),
        contract.map_or(0.0, |c| f32::from(rules.bid_value(c)) / POINTS),
    );
}

/// The rules, whole: scaled numbers and one-hots. Rules about single cards
/// (misdeal values, joker-call cards, per-card policies) also show in the
/// card rows, where they mean the most.
fn rules_features(f: &mut Features, r: &Rules) {
    let small = |n: i8| f32::from(n) / 4.0;
    f.one_hot(
        "rules.players",
        &["1", "2", "3", "4", "5", "6", "7", "8"],
        r.players.checked_sub(1),
    );
    f.num("rules.hand_size", r.hand_size as f32 / 13.0);
    f.num("rules.kitty", r.kitty_size() as f32 / 8.0);
    f.num("rules.deck_size", r.deck_size() as f32 / SLOTS as f32);
    f.flag("rules.two_jokers", r.deck.jokers().len() > 1);
    f.num("rules.lowest_rank", f32::from(r.lowest_rank - 2) / 8.0);
    f.num("rules.extra_cards", r.extra_cards.len() as f32 / 4.0);

    let m = &r.misdeal;
    f.num("rules.misdeal.point_value", small(m.point_value));
    f.num("rules.misdeal.joker_value", small(m.joker_value));
    f.num("rules.misdeal.threshold", f32::from(m.threshold) / 8.0);
    f.flag("rules.misdeal.all_points", m.all_points);
    f.one_hot(
        "rules.misdeal.window",
        &["own_turn_until_bid", "all_bidding", "before_first_bid"],
        Some(match m.window {
            MisdealWindow::OwnTurnUntilBid => 0,
            MisdealWindow::AllBidding => 1,
            MisdealWindow::BeforeFirstBid => 2,
        }),
    );
    f.flag("rules.misdeal.declarer", m.declarer);
    f.flag("rules.misdeal.caller_deals", m.caller_deals);

    let b = &r.bidding;
    f.num("rules.bidding.min", f32::from(b.min) / POINTS);
    f.num("rules.bidding.max", f32::from(b.max) / POINTS);
    f.flag("rules.bidding.allow_no_trump", b.allow_no_trump);
    f.num("rules.bidding.no_trump_bonus", f32::from(b.no_trump_bonus) / 4.0);
    f.flag("rules.bidding.no_trump_wins_ties", b.no_trump_wins_ties);
    f.flag("rules.bidding.first_bidder_may_pass", b.first_bidder_may_pass);
    f.num("rules.bidding.change_trump_cost", f32::from(b.change_trump_cost) / 4.0);
    f.flag(
        "rules.bidding.change_to_no_trump_cost.set",
        b.change_to_no_trump_cost.is_some(),
    );
    f.num(
        "rules.bidding.change_to_no_trump_cost",
        f32::from(b.change_to_no_trump_cost.unwrap_or(0)) / 4.0,
    );
    f.flag("rules.bidding.pass_is_final", b.pass_is_final);
    f.flag("rules.bidding.last_chance_min.set", b.last_chance_min.is_some());
    f.num(
        "rules.bidding.last_chance_min",
        f32::from(b.last_chance_min.unwrap_or(0)) / POINTS,
    );
    f.flag("rules.bidding.raise_on_exchange", b.raise_on_exchange);

    let fr = &r.friend;
    f.flag("rules.friend.by_card", fr.by_card);
    f.flag("rules.friend.by_seat", fr.by_seat);
    f.flag("rules.friend.first_trick", fr.first_trick);
    f.flag("rules.friend.last_trick", fr.last_trick);
    f.flag("rules.friend.fake", fr.fake);
    f.flag("rules.friend.alone", fr.alone);

    let p = &r.policy;
    let policy = |f: &mut Features, name: &str, t: TrickPolicy| {
        f.one_hot(&format!("{name}.first"), &POLICY_LABELS, Some(policy_index(t.first)));
        f.one_hot(&format!("{name}.last"), &POLICY_LABELS, Some(policy_index(t.last)));
    };
    policy(f, "rules.policy.mighty", p.mighty);
    policy(f, "rules.policy.trump", p.trump);
    policy(f, "rules.policy.joker", p.joker);
    policy(f, "rules.policy.joker_call", p.joker_call);
    f.num("rules.policy.overrides", p.overrides.len() as f32 / 4.0);
    f.flag("rules.policy.release_with_mighty", p.release_with_mighty);

    f.flag("rules.joker_call.mighty_defense", r.joker_call.mighty_defense);
    f.flag(
        "rules.joker_call.called_joker_has_power",
        r.joker_call.called_joker_has_power,
    );
    f.flag("rules.joker_lead.by_color", r.joker_lead.by_color);
    f.flag("rules.joker_lead.powerless_passes", r.joker_lead.powerless_passes);
    f.flag("rules.joker_lead.not_first_trick", r.joker_lead.not_first_trick);

    let s = &r.scoring;
    let (win, both_over) = match s.win {
        WinScore::OverTen => (0, 0),
        WinScore::OverMin => (1, 0),
        WinScore::OverBid => (2, 0),
        WinScore::BidBonus => (3, 0),
        WinScore::BothOver(n) => (4, n),
    };
    f.one_hot(
        "rules.scoring.win",
        &["over_ten", "over_min", "over_bid", "bid_bonus", "both_over"],
        Some(win),
    );
    f.num("rules.scoring.win.both_over", f32::from(both_over) / POINTS);
    let (lose, pays_back) = match s.lose {
        LoseScore::Shortfall => (0, 0),
        LoseScore::PaysBack(n) => (1, n),
    };
    f.one_hot("rules.scoring.lose", &["shortfall", "pays_back"], Some(lose));
    f.num("rules.scoring.lose.pays_back", f32::from(pays_back) / POINTS);
    f.one_hot(
        "rules.scoring.no_trump",
        &DOUBLING_LABELS,
        Some(doubling_index(s.no_trump)),
    );
    f.one_hot("rules.scoring.alone", &DOUBLING_LABELS, Some(doubling_index(s.alone)));
    f.flag("rules.scoring.run", s.run);
    let (back_run, back_run_n) = match s.back_run {
        BackRun::Never => (0, 0),
        BackRun::TeamAtMost(n) => (1, n),
        BackRun::ShortBy(n) => (2, n),
        BackRun::DefenceReachesBid => (3, 0),
    };
    f.one_hot(
        "rules.scoring.back_run",
        &["never", "team_at_most", "short_by", "defence_reaches_bid"],
        Some(back_run),
    );
    f.num("rules.scoring.back_run.n", f32::from(back_run_n) / POINTS);
    f.one_hot(
        "rules.scoring.full_contract",
        &DOUBLING_LABELS,
        Some(doubling_index(s.full_contract)),
    );
    f.flag("rules.scoring.discards_to_declarer", s.discards_to_declarer);
    f.flag("rules.reveal_discards", r.reveal_discards);
    f.one_hot(
        "rules.next_dealer",
        &["rotate", "friend_or_declarer"],
        Some(match r.next_dealer {
            NextDealer::Rotate => 0,
            NextDealer::FriendOrDeclarer => 1,
        }),
    );
}

/// What the card in `card` means now and where it is, as the viewer knows.
struct CardRow {
    card: Card,
    strength: f32,
    /// Live, and would win the trick under way if played now.
    would_win: bool,
    playable: bool,
}

fn card_features(f: &mut Features, t: &Table, row: &CardRow) {
    let card = row.card;
    let rules = t.rules;
    let place = t.places[card.slot()];
    let present = place != Place::Absent;
    // Everything below the identity is zero for a card this deck lacks.
    let on = |b: bool| present && b;

    f.flag("in_deck", present);
    f.one_hot("suit", &["♠", "♦", "♥", "♣"], card.suit().map(|s| s as usize));
    f.flag("joker", card.is_joker());
    f.flag(
        "red",
        matches!(
            card,
            Card::Normal(Suit::Diamond | Suit::Heart, _) | Card::Joker(Color::Red)
        ),
    );
    f.num(
        "rank",
        card.rank().map_or(0.0, |r| f32::from(r - 2) / f32::from(ACE - 2)),
    );

    // What the rules make of it, under the trump that now decides.
    f.flag("point", on(card.is_point()));
    f.num(
        "misdeal_value",
        if present {
            f32::from(rules.misdeal_value(card)) / 4.0
        } else {
            0.0
        },
    );
    f.flag("trump", on(t.trump.is_some() && card.suit() == t.trump));
    f.flag("mighty", on(card == rules.mighty(t.trump)));
    let calls_joker = rules
        .deck
        .jokers()
        .iter()
        .any(|&joker| !t.gone(joker) && rules.joker_call_card(joker, t.trump) == Some(card));
    f.flag("joker_caller", on(calls_joker));
    let policy = |trick| present.then(|| policy_index(rules.policy(card, t.trump, trick)));
    f.one_hot("policy.first", &POLICY_LABELS, policy(0));
    f.one_hot("policy.last", &POLICY_LABELS, policy(rules.hand_size - 1));
    f.flag("friend_card", on(t.call == Some(FriendCall::Card(card))));

    // In the trick under way.
    f.flag("powered", on(powered(rules, t.trick_state(t.lead), card)));
    f.flag("follows", on(t.lead.is_some_and(|lead| lead.follows(card))));
    f.num("strength", row.strength);
    f.flag("would_win", on(row.would_win));
    f.flag("playable", row.playable);
    f.flag("called_joker", on(t.called_joker == Some(card)));

    // Where it is, as far as the viewer knows.
    f.flag("mine", place == Place::Mine);
    f.flag("unseen", place == Place::Unseen);
    f.flag("discarded", place == Place::Discarded);
    let trick_by = match place {
        Place::Trick(seat) => Some(t.rel(seat)),
        _ => None,
    };
    f.each("in_trick_by", MAX_SEATS, |k| f32::from(u8::from(trick_by == Some(k))));
    let (played_by, won_by, trick, led) = match place {
        Place::Played { trick, by, won_by, led } => (Some(t.rel(by)), Some(t.rel(won_by)), Some(trick), led),
        Place::Trick(_) => (None, None, None, t.plays.first().map(|p| p.card) == Some(card)),
        _ => (None, None, None, false),
    };
    f.each("played_by", MAX_SEATS, |k| f32::from(u8::from(played_by == Some(k))));
    f.each("won_by", MAX_SEATS, |k| f32::from(u8::from(won_by == Some(k))));
    f.num(
        "played_on_trick",
        trick.map_or(0.0, |i| (i + 1) as f32 / rules.hand_size as f32),
    );
    f.flag("led", led);
}

/// One thing that happened this deal, as the viewer saw it.
#[derive(Debug, Clone, Copy, Default)]
struct Event {
    kind: usize,
    actor: Option<Seat>,
    contract: Option<Contract>,
    card: Option<Card>,
    call: Option<FriendCall>,
    powered: bool,
    led: bool,
    lead: Option<Lead>,
    trick: Option<usize>,
    points: usize,
}

fn events(t: &Table) -> Vec<Event> {
    let view = t.view;
    let event = |kind, actor| Event {
        kind,
        actor: Some(actor),
        ..Event::default()
    };
    let mut events = Vec::new();

    for bid in &view.bids {
        events.push(Event {
            contract: bid.contract,
            ..event(if bid.contract.is_some() { BID_MADE } else { PASSED }, bid.seat)
        });
    }
    if let (Some(declarer), Some(contract)) = (t.declarer, t.contract)
        && Some(contract) != winning_bid(&view.bids)
    {
        events.push(Event {
            contract: Some(contract),
            ..event(CONTRACT_SET, declarer)
        });
    }
    if let Some(declarer) = t.declarer {
        events.extend(t.discards.iter().map(|&card| Event {
            card: Some(card),
            ..event(DISCARDED, declarer)
        }));
        if let Some(call) = t.call {
            let card = match call {
                FriendCall::Card(card) => Some(card),
                _ => None,
            };
            events.push(Event {
                call: Some(call),
                card,
                ..event(CALLED, declarer)
            });
        }
    }
    let play = |trick, lead, i: usize, p: &Played| Event {
        card: Some(p.card),
        powered: p.powered,
        led: i == 0,
        lead,
        trick: Some(trick),
        ..event(PLAYED, p.seat)
    };
    for (i, trick) in t.tricks.iter().enumerate() {
        events.extend(
            trick
                .plays
                .iter()
                .enumerate()
                .map(|(j, p)| play(i, Some(trick.lead), j, p)),
        );
        events.push(Event {
            trick: Some(i),
            points: trick.plays.iter().filter(|p| p.card.is_point()).count(),
            ..event(TRICK_DONE, trick.winner)
        });
    }
    events.extend(t.plays.iter().enumerate().map(|(j, p)| play(t.trick_no, t.lead, j, p)));
    events
}

fn event_features(f: &mut Features, t: &Table, e: &Event) {
    let rel = |seat: Option<Seat>| seat.map(|s| t.rel(s));
    let actor = rel(e.actor);
    f.one_hot("kind", &EVENT_LABELS, Some(e.kind));
    f.each("actor", MAX_SEATS, |k| f32::from(u8::from(actor == Some(k))));
    f.one_hot(
        "contract.trump",
        &TRUMP_LABELS,
        e.contract.map(|c| trump_index(c.trump)),
    );
    f.num(
        "contract.count",
        e.contract.map_or(0.0, |c| f32::from(c.count) / POINTS),
    );
    f.one_hot("call", &CALL_LABELS, e.call.map(call_index));
    let named = match e.call {
        Some(FriendCall::Seat(seat)) => Some(t.rel(seat)),
        _ => None,
    };
    f.each("call.seat", MAX_SEATS, |k| f32::from(u8::from(named == Some(k))));
    f.flag("powered", e.powered);
    f.flag("led", e.led);
    f.flag(
        "follows",
        e.lead.zip(e.card).is_some_and(|(lead, card)| lead.follows(card)),
    );
    f.one_hot("lead", &LEAD_LABELS, e.lead.map(lead_index));
    f.num(
        "trick",
        e.trick.map_or(0.0, |i| (i + 1) as f32 / t.rules.hand_size as f32),
    );
    f.num("points", e.points as f32 / POINTS);
}

/// The names of the global, card and event features.
struct Names {
    global: Vec<String>,
    card: Vec<String>,
    event: Vec<String>,
}

/// Encodes `view`; with `named`, also names every feature, in the same
/// pass so the names always match the values.
fn encode_into(view: &View, legal: &[Action], named: bool) -> (Observation, Option<Names>) {
    let t = Table::new(view);
    // Each array is written by one builder, row after row: allocating per
    // row was most of the cost of an encoding.
    let features = |capacity| {
        if named {
            Features::named()
        } else {
            Features::with_capacity(capacity)
        }
    };
    // The names of a builder's first `width` features.
    let names = |f: &Features, width: usize| f.names().map(|n| n[..width].to_vec()).unwrap_or_default();

    let mut playable = [false; SLOTS];
    for action in legal {
        if let Action::Play { card, .. } = action {
            playable[card.slot()] = true;
        }
    }
    let in_play = matches!(view.phase, PhaseView::Play { .. });
    let mut trick = Vec::with_capacity(MAX_SEATS);
    let mut cards = features(SLOTS * 64);
    for (i, strength) in t.strengths().into_iter().enumerate() {
        let card = Card::from_slot(i);
        let row = CardRow {
            card,
            strength,
            would_win: in_play && t.live(card) && t.would_win(card, &mut trick),
            playable: playable[i],
        };
        card_features(&mut cards, &t, &row);
    }
    let card_width = cards.len() / SLOTS;

    let all = events(&t);
    let kept = &all[all.len().saturating_sub(MAX_EVENTS)..];
    // A blank row gives the width and names even before anything happened.
    let mut blank = features(64);
    event_features(&mut blank, &t, &Event::default());
    let width = blank.len();
    let mut rows = Features::with_capacity(MAX_EVENTS * width);
    let mut event_cards = vec![-1; MAX_EVENTS];
    for (i, e) in kept.iter().enumerate() {
        event_features(&mut rows, &t, e);
        event_cards[i] = e.card.map_or(-1, |c| c.slot() as i32);
    }
    let mut events = rows.into_values();
    events.resize(MAX_EVENTS * width, 0.0);

    let mut g = features(256);
    global(&mut g, &t);
    g.num("events_dropped", (all.len() - kept.len()) as f32 / MAX_EVENTS as f32);

    let names = named.then(|| Names {
        global: names(&g, g.len()),
        card: names(&cards, card_width),
        event: names(&blank, width),
    });
    let obs = Observation {
        global: g.into_values(),
        cards: cards.into_values(),
        events,
        event_cards,
        events_len: kept.len(),
        legal: Mighty::legal_mask(view, legal, ACTIONS),
    };
    (obs, names)
}

impl Encode for Mighty {
    fn spec(options: &Options) -> Result<Spec, Unsupported> {
        let rules = &options.rules;
        rules.validate().map_err(|e| Unsupported(e.to_string()))?;
        if rules.bidding.max > MAX_COUNT {
            return Err(Unsupported(format!(
                "contracts up to {}, the action space stops at {MAX_COUNT}",
                rules.bidding.max
            )));
        }
        // The names do not depend on the position; any view gives them.
        let state = Mighty::new_game(options).map_err(|e| Unsupported(e.to_string()))?;
        let view = Mighty::view(&state, Viewer::Seat(0));
        let names = encode_into(&view, &[], true).1.expect("names were asked for");
        Ok(Spec {
            version: VERSION.to_string(),
            global: names.global,
            cards: (0..SLOTS).map(|i| Card::from_slot(i).to_string()).collect(),
            card_features: names.card,
            max_events: MAX_EVENTS,
            event_features: names.event,
            actions: (0..ACTIONS).map(action_name).collect(),
            belief_classes: (0..MAX_SEATS)
                .map(|k| format!("seat+{k}"))
                .chain(["buried".to_string()])
                .collect(),
        })
    }

    fn encode(view: &View, legal: &[Action]) -> Observation {
        encode_into(view, legal, false).0
    }

    fn action_index(view: &View, action: &Action) -> Option<usize> {
        let me = match view.viewer {
            Viewer::Seat(seat) => seat,
            Viewer::Spectator => 0,
        };
        action_index(me, view.rules.players, action)
    }

    fn belief_targets(state: &State, viewer: Seat) -> Vec<i32> {
        let view = Mighty::view(state, Viewer::Seat(viewer));
        let table = Table::new(&view);
        let players = state.seats();
        let buried: Vec<Card> = state
            .kitty()
            .iter()
            .chain(state.declared().map_or(&[][..], |d| &d.discards))
            .copied()
            .collect();
        (0..SLOTS)
            .map(|i| {
                let card = Card::from_slot(i);
                if table.places[i] != Place::Unseen {
                    return -1;
                }
                if let Some(seat) = state.hands().iter().position(|h| h.contains(&card)) {
                    relative(viewer, seat, players) as i32
                } else if buried.contains(&card) {
                    BURIED
                } else {
                    // Not dealt yet.
                    debug_assert!(matches!(state.phase(), Phase::Dealing), "{card} is nowhere");
                    -1
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::Preset;
    use engine::Turn;
    use rand::seq::IndexedRandom;
    use rand::{Rng, SeedableRng};
    use rand_chacha::ChaCha8Rng;

    /// Strengths as first written: every live card played first against
    /// every other in a two-card trick.
    fn strengths_by_tricks(t: &Table) -> [f32; SLOTS] {
        let live = t.live_played();
        let mut strengths = [0.0; SLOTS];
        for &first in &live {
            let ctx = t.context(t.lead.unwrap_or_else(|| natural_lead(first.card)));
            let beaten = live
                .iter()
                .filter(|other| other.card != first.card)
                .filter(|&&other| trick::winner(&ctx, &[first, Played { seat: 1, ..other }]) == 1)
                .count();
            let others = live.len() - 1;
            strengths[first.card.slot()] = if others == 0 {
                1.0
            } else {
                1.0 - beaten as f32 / others as f32
            };
        }
        strengths
    }

    /// The fast strengths equal the trick-by-trick ones bit for bit, for
    /// every seat of every position of random hands over varied rules.
    #[test]
    fn strengths_match_two_card_tricks() {
        let mut rng = ChaCha8Rng::seed_from_u64(3);
        let mut positions = 0;
        for game in 0..40 {
            let rules = Preset::ALL[game % Preset::ALL.len()].rules().varied(&mut rng);
            let players = rules.players;
            let options = Options {
                rules,
                first_bidder: rng.random_range(0..players),
            };
            let mut state = Mighty::new_game(&options).unwrap();
            loop {
                for seat in 0..players {
                    let view = Mighty::view(&state, Viewer::Seat(seat));
                    let t = Table::new(&view);
                    let (fast, slow) = (t.strengths(), strengths_by_tricks(&t));
                    assert_eq!(fast.map(f32::to_bits), slow.map(f32::to_bits), "{view:?}");
                    positions += 1;
                }
                let action = match Mighty::turn(&state) {
                    Turn::Over => break,
                    Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                    Turn::Seat(_) => Mighty::legal_actions(&state).choose(&mut rng).unwrap().clone(),
                };
                Mighty::apply(&mut state, action).unwrap();
            }
        }
        assert!(positions > 5_000, "only {positions} positions");
    }
}
