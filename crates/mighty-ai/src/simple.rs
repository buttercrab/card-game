//! A rule-based bot. It fills an empty seat on its own, and it plays every
//! seat inside the search bot's playouts, so the search is only as good as
//! these rules.

use crate::seen::{Seen, SeenPhase};
use engine::{Bot, Seat};
use mighty::card::{ACE, Card, CardSet, Suit};
use mighty::rules::{CardPolicy, Contract, MAX_PLAYERS, Rules};
use mighty::trick::{self, Lead, Played};
use mighty::world::{TrickState, powered};
use mighty::{Action, FriendCall, Mighty, PhaseView, View};
use rand::seq::IndexedRandom;
use rand::{Rng, RngCore};

/// The weights and thresholds behind the rules. The defaults were tuned
/// with `sim --baseline`, one weight at a time against the previous best;
/// see `crates/sim` for how to try others (`simple@bid_base=7` sets a
/// weight by its name here). How the tuning went is in
/// `research/experiments/2026-10-05-bot-fixes`.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SimpleBot {
    /// Points a hand promises before counting anything: the kitty and the
    /// friend bring some.
    pub bid_base: f32,
    /// Per trump other than the mighty.
    pub bid_trump: f32,
    /// Extra for the trump ace, king and queen.
    pub bid_trump_honor: f32,
    pub bid_mighty: f32,
    pub bid_joker: f32,
    /// With two jokers, for the one not of trump's colour.
    pub bid_sub_joker: f32,
    /// Per side ace; the mighty counts as one too.
    pub bid_ace: f32,
    pub bid_king: f32,
    /// How much better another trump must look, after the kitty, to pay
    /// for changing to it.
    pub change_trump: f32,
    /// The declarer's side leads trump to draw the opponents' only while
    /// holding at least this many; drawing early mostly wasted trumps.
    pub draw_trumps: usize,
    /// The last this many tricks count as late: the mighty and jokers come
    /// out, and every trick is worth taking.
    pub late_tricks: usize,
    /// Points a trick must hold before the mighty or a joker takes it.
    pub special_worth: usize,
    /// Scores for leading, against 100 for a side ace: a point card's
    /// penalty when giving the lead away, the joker and the mighty before
    /// the late tricks, and trump for a defender.
    pub lead_point_penalty: i32,
    pub lead_joker: i32,
    pub lead_mighty: i32,
    pub defend_trump: i32,
    /// Points of estimate per unit of log-odds of making a contract: how
    /// far a hand must clear a bid when the rules make failing cost more
    /// than making pays ([`SimpleBot::needed`]). 0 bids at the estimate
    /// whatever the scoring.
    pub bid_spread: f32,
    /// Points more than the estimate needs before bidding at all: the
    /// table's 초보 is more careful.
    pub bid_caution: f32,
}

impl Default for SimpleBot {
    fn default() -> SimpleBot {
        SimpleBot {
            bid_base: 6.0,
            bid_trump: 1.25,
            bid_trump_honor: 1.25,
            bid_mighty: 1.0,
            bid_joker: 2.0,
            bid_sub_joker: 1.0,
            bid_ace: 1.0,
            bid_king: 0.5,
            change_trump: 2.0,
            draw_trumps: 8,
            late_tricks: 2,
            special_worth: 1,
            lead_point_penalty: 15,
            lead_joker: -40,
            lead_mighty: -100,
            defend_trump: -100,
            bid_spread: 1.9,
            bid_caution: 0.0,
        }
    }
}

/// Bid boldness by seat, added to `bid_base`, so a table of bots does not
/// bid as one.
pub const TEMPER: [f32; MAX_PLAYERS] = [0.0, 0.2, -0.2, 0.1, -0.1, 0.15, -0.15, 0.05];

/// The simple bot with `seat`'s temper, as the table seats it.
pub fn tempered(seat: usize) -> SimpleBot {
    let mut bot = SimpleBot::default();
    bot.bid_base += TEMPER[seat % TEMPER.len()];
    bot
}

/// How often the table's 초보 slips when playing a card.
pub const EASY_SLIPS: f64 = 0.35;

/// How many points more carefully the table's 초보 bids.
pub const EASY_CAUTION: f32 = 1.0;

/// The simple bot, slipping to a random card this often when it plays
/// one: the table's 초보. A slip picks among the cheap cards (never the
/// mighty, a joker or a joker call) and the card the simple bot chose, so
/// it gives a trick away now and then but never throws a big card.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Clumsy {
    pub inner: SimpleBot,
    pub slips: f64,
}

impl Clumsy {
    /// The table's 초보 on top of `inner`: slipping [`EASY_SLIPS`] of the
    /// time and bidding [`EASY_CAUTION`] points more carefully.
    pub fn easy(mut inner: SimpleBot) -> Clumsy {
        inner.bid_caution += EASY_CAUTION;
        Clumsy {
            inner,
            slips: EASY_SLIPS,
        }
    }
}

impl Bot<Mighty> for Clumsy {
    fn act(&mut self, view: &View, legal: &[Action], rng: &mut dyn RngCore) -> Action {
        let choice = self.inner.decide(&Seen::of_view(view), legal);
        let PhaseView::Play { contract, .. } = &view.phase else {
            return choice;
        };
        if legal.len() == 1 || !rng.random_bool(self.slips) {
            return choice;
        }
        let mighty = view.rules.mighty(contract.trump);
        let cheap: Vec<&Action> = legal
            .iter()
            .filter(|a| match a {
                Action::Play { card, call_joker, .. } => !call_joker && !card.is_joker() && *card != mighty,
                _ => false,
            })
            .chain(std::iter::once(&choice))
            .collect();
        cheap.choose(rng).map_or_else(|| choice.clone(), |a| (*a).clone())
    }
}

impl Bot<Mighty> for SimpleBot {
    fn act(&mut self, view: &View, legal: &[Action], _rng: &mut dyn RngCore) -> Action {
        self.decide(&Seen::of_view(view), legal)
    }
}

impl SimpleBot {
    /// What [`Bot::act`] chooses; it never needs randomness. Where its
    /// rules have nothing to say, the first legal action.
    ///
    /// # Panics
    ///
    /// When `legal` is empty: a seat to act always has a legal action.
    pub(crate) fn decide(&self, view: &Seen, legal: &[Action]) -> Action {
        let choice = match &view.phase {
            SeenPhase::Bidding => self.bid(view, legal),
            SeenPhase::Exchange { contract, .. } => self.exchange(view, legal, contract.trump),
            SeenPhase::Play { .. } => play(self, view, legal),
            SeenPhase::Idle => None,
        };
        choice
            .or_else(|| legal.first().cloned())
            .expect("a seat to act has a legal action")
    }

    /// Rough number of points a hand could promise with `trump`: long and
    /// high trump, the mighty, jokers and side aces. No-trump is never
    /// bid; these rules play it badly.
    pub fn estimate(&self, rules: &Rules, hand: &[Card], trump: Option<Suit>) -> f32 {
        let mighty = rules.mighty(trump);
        let count = |f: &dyn Fn(&Card) -> bool| hand.iter().filter(|c| f(c)).count() as f32;
        let trumps = count(&|c| c.suit() == trump && trump.is_some() && *c != mighty);
        let honors = count(&|c| c.suit() == trump && trump.is_some() && *c != mighty && c.rank() >= Some(ACE - 2));
        // With two jokers, the one not of trump's colour ranks below trump.
        let main = trump.map(|t| Card::Joker(t.color()));
        let two = rules.deck.jokers().len() > 1;
        let jokers = count(&|c| c.is_joker() && !(two && Some(*c) != main));
        let sub_jokers = count(&|c| c.is_joker() && two && Some(*c) != main);
        // The mighty is a side ace too; it counts as both (tuned that way).
        let aces = count(&|c| c.rank() == Some(ACE) && c.suit() != trump);
        let kings = count(&|c| c.rank() == Some(ACE - 1) && c.suit() != trump);
        self.bid_base
            + self.bid_trump * trumps
            + self.bid_trump_honor * honors
            + self.bid_mighty * f32::from(u8::from(hand.contains(&mighty)))
            + self.bid_joker * jokers
            + self.bid_sub_joker * sub_jokers
            + self.bid_ace * aces
            + self.bid_king * kings
    }

    /// The estimate a hand needs to bid `contract`: the count, and more
    /// when the rules make a failed contract cost more than a made one
    /// pays. Making it by one and failing by two are taken as typical;
    /// the share of hands that must make it to break even is then
    /// `lost / (won + lost)`, and with make rates rising by about one
    /// unit of log-odds per `bid_spread` points of estimate (measured on
    /// simple bots, 경기과고 and 기본), the hand must clear the bid by
    /// `bid_spread` × those odds' log. Scorings that pay more for making
    /// than failing costs (기본's, web-mighty's) need nothing extra: the
    /// estimate already makes about half its bids.
    pub fn needed(&self, rules: &Rules, contract: Contract) -> f32 {
        let count = f32::from(contract.count) + self.bid_caution;
        if self.bid_spread <= 0.0 {
            return count;
        }
        let won = mighty::score::value(rules, contract, false, (contract.count + 1).min(20)) as f32;
        let lost = -mighty::score::value(rules, contract, false, contract.count.saturating_sub(2)) as f32;
        if won <= 0.0 || lost <= 0.0 {
            return count;
        }
        count + (self.bid_spread * (lost / won).ln()).max(0.0)
    }

    /// Whether it throws `hand` in where the rules let it (a 딜미스): only
    /// a hand that could not bid the minimum in any suit anyway. It decides
    /// the same on its turn to bid and off it, the moment the cards land.
    pub fn calls_misdeal(&self, rules: &Rules, hand: &[Card]) -> bool {
        let best = Suit::ALL
            .into_iter()
            .map(|suit| self.estimate(rules, hand, Some(suit)))
            .fold(f32::NEG_INFINITY, f32::max);
        best < f32::from(rules.bidding.min)
    }

    fn bid(&self, view: &Seen, legal: &[Action]) -> Option<Action> {
        let estimate = |trump: Option<Suit>| self.estimate(view.rules, view.hand, trump);
        let trump = Suit::ALL
            .into_iter()
            .map(Some)
            .max_by(|&a, &b| estimate(a).total_cmp(&estimate(b)))?;
        if legal.contains(&Action::Misdeal) && self.calls_misdeal(view.rules, view.hand) {
            return Some(Action::Misdeal);
        }
        let cheapest = |trump: Option<Suit>| {
            legal
                .iter()
                .filter_map(|a| match a {
                    Action::Bid(c) if c.trump == trump => Some(*c),
                    _ => None,
                })
                .min_by_key(|c| c.count)
        };
        match cheapest(trump) {
            Some(c) if self.needed(view.rules, c) <= estimate(trump) || !legal.contains(&Action::Pass) => {
                Some(Action::Bid(c))
            }
            _ => Some(Action::Pass),
        }
    }

    fn exchange(&self, view: &Seen, legal: &[Action], trump: Option<Suit>) -> Option<Action> {
        let estimate = |trump: Option<Suit>| self.estimate(view.rules, view.hand, trump);
        if legal.iter().any(|a| matches!(a, Action::Discard(_))) {
            // The kitty may have made another trump much better.
            let change = legal
                .iter()
                .filter_map(|a| match a {
                    Action::ChangeTrump(Some(t)) => Some(Some(*t)),
                    _ => None,
                })
                .filter(|&t| estimate(t) >= estimate(trump) + self.change_trump)
                .max_by(|&a, &b| estimate(a).total_cmp(&estimate(b)));
            return change.map(Action::ChangeTrump).or_else(|| discard(view, legal, trump));
        }
        // The strongest card it lacks makes the best friend. With two
        // jokers, the one of trump's colour outranks trump; the other
        // comes after the trump king. Leaving it to the first trick picks
        // a friend at random.
        let jokers = view.rules.deck.jokers();
        let main_joker = jokers
            .iter()
            .copied()
            .find(|&j| trump.is_some_and(|t| j == Card::Joker(t.color())));
        let main_joker = main_joker.unwrap_or(jokers[0]);
        let other_joker = jokers.iter().copied().find(|&j| j != main_joker);
        let trump_card = |rank| trump.map(|t| Card::new(t, rank));
        let wanted = [
            Some(view.rules.mighty(trump)),
            Some(main_joker),
            trump_card(ACE),
            trump_card(ACE - 1),
            other_joker,
            trump_card(ACE - 2),
        ]
        .into_iter()
        .flatten()
        .filter(|c| !view.hand.contains(c) && !discarded(view).contains(c))
        .map(FriendCall::Card)
        .chain([FriendCall::FirstTrick]);
        wanted.map(Action::CallFriend).find(|a| legal.contains(a))
    }
}

/// The declarer's own discards, as it sees them while exchanging: calling
/// one of them as the friend would call nobody.
pub(crate) fn discarded<'a>(view: &Seen<'a>) -> &'a [Card] {
    match view.phase {
        SeenPhase::Exchange { discards, .. } => discards,
        _ => &[],
    }
}

/// How much a card is worth keeping: the mighty, then jokers, then trumps
/// by rank, then everything else by rank.
fn power(view: &Seen, trump: Option<Suit>, card: Card) -> u8 {
    if card == view.rules.mighty(trump) {
        KEEP_MIGHTY
    } else if card.is_joker() {
        KEEP_JOKER
    } else if card.suit() == trump {
        KEEP_TRUMP + card.rank().unwrap_or(0)
    } else {
        card.rank().unwrap_or(0)
    }
}

/// [`power`]'s tiers: plain cards count their rank (2 to 14), trumps this
/// much more, and the jokers and the mighty above every trump.
const KEEP_TRUMP: u8 = 40;
const KEEP_JOKER: u8 = 90;
const KEEP_MIGHTY: u8 = 100;
/// The [`power`] of a big card, worth winning a trick with even when a foe
/// plays after: a trump ten or higher, a joker or the mighty.
const BIG_CARD: u8 = KEEP_TRUMP + 10;

/// Discarded point cards still count for the declarer, so side-suit tens to
/// kings are best put back: they are points banked. After them, the
/// shortest side suits go, to make voids that trump can ruff.
fn discard(view: &Seen, legal: &[Action], trump: Option<Suit>) -> Option<Action> {
    let mighty = view.rules.mighty(trump);
    let length = |suit: Suit| view.hand.iter().filter(|c| c.suit() == Some(suit)).count();
    let keep = |c: Card| c == mighty || c.is_joker() || c.suit() == trump || c.rank() == Some(ACE);
    legal
        .iter()
        .filter_map(|a| match a {
            Action::Discard(c) => Some(*c),
            _ => None,
        })
        .min_by_key(|&c| {
            let banked = c.is_point() && !keep(c);
            let suit_len = c.suit().map_or(99, length);
            (keep(c), !banked, suit_len, power(view, trump, c))
        })
        .map(Action::Discard)
}

/// What one seat knows during play.
struct Table<'a> {
    bot: &'a SimpleBot,
    view: &'a Seen<'a>,
    me: Seat,
    trump: Option<Suit>,
    mighty: Card,
    trick_no: usize,
    /// Every card not in my hand and not yet played.
    unseen: CardSet,
    /// Summaries of `unseen` for [`Table::sure_lead`], which runs often:
    /// whether a joker or the mighty is out, whether a trump is, and the
    /// highest rank out in each suit (the mighty aside).
    specials_out: bool,
    trumps_out: bool,
    top_out: [u8; 4],
    /// Seats known to be on my side, a bit each.
    friends: u32,
    attacking: bool,
    /// The card the declarer called, while its holder is unknown.
    called: Option<Card>,
    /// Jokers the declarer may hold, which its friend so must not call:
    /// only calling one as the friend shows the declarer lacks it.
    spared: CardSet,
}

impl Table<'_> {
    /// The cards in `unseen`.
    fn unseen(&self) -> impl Iterator<Item = Card> {
        self.unseen.iter()
    }

    fn is_friend(&self, seat: Seat) -> bool {
        self.friends & (1 << seat) != 0
    }

    fn power(&self, card: Card) -> u8 {
        power(self.view, self.trump, card)
    }

    /// The trick under way as the rules see it, `called` its called joker.
    fn trick(&self, lead: Option<Lead>, called: Option<Card>) -> TrickState {
        TrickState {
            trump: self.trump,
            trick_no: self.trick_no,
            lead,
            called_joker: called,
        }
    }

    fn powered(&self, card: Card, called: Option<Card>) -> bool {
        powered(self.view.rules, self.trick(None, called), card)
    }

    /// No unseen card can beat this one if it is led: it is the mighty, or
    /// the top of its suit with the mighty and jokers already gone.
    fn sure_lead(&self, card: Card) -> bool {
        if card == self.mighty {
            return true;
        }
        let (Some(suit), Some(rank)) = (card.suit(), card.rank()) else {
            return false;
        };
        let higher_out = self.top_out[suit as usize] > rank;
        let ruffable = Some(suit) != self.trump && self.trumps_out;
        !self.specials_out && !higher_out && !ruffable
    }

    /// A joker with power now that would have none on the last trick,
    /// played on the trick before it: holding it on wastes it.
    fn doomed(&self, card: Card) -> bool {
        let rules = &self.view.rules;
        let last = rules.hand_size - 1;
        card.is_joker()
            && self.trick_no + 1 == last
            && self.powered(card, None)
            && rules.policy(card, self.trump, last) == CardPolicy::NoEffect
    }

    /// How much a card is worth keeping for the tricks still to come.
    fn keep(&self, card: Card) -> u8 {
        if self.doomed(card) { 0 } else { self.power(card) }
    }

    fn late(&self) -> bool {
        self.trick_no + self.bot.late_tricks >= self.view.rules.hand_size
    }
}

/// Every card these rules deal that `view`'s seat has not seen: not in
/// its hand, not played and, for the declarer, not among its own discards.
fn unseen(view: &Seen, tricks: &[trick::Trick], plays: &[Played], discards: Option<&[Card]>) -> CardSet {
    let played = tricks.iter().flat_map(|t| &t.plays).chain(plays).map(|p| p.card);
    let mut seen: CardSet = played.chain(view.hand.iter().copied()).collect();
    seen.extend(discards.into_iter().flatten().copied());
    view.rules.card_set() - seen
}

fn card_of(a: &Action) -> Card {
    a.played_card().expect("only plays are legal during play")
}

fn play(bot: &SimpleBot, view: &Seen, legal: &[Action]) -> Option<Action> {
    let t = table(bot, view)?;
    let SeenPhase::Play {
        lead,
        plays,
        called_joker,
        ..
    } = &view.phase
    else {
        return None;
    };
    match lead {
        None => Some(lead_card(&t, legal)),
        Some(lead) => Some(follow(&t, legal, *lead, plays, *called_joker)),
    }
}

/// What `view`'s seat knows during play; `None` outside it.
fn table<'a>(bot: &'a SimpleBot, view: &'a Seen<'a>) -> Option<Table<'a>> {
    let SeenPhase::Play {
        declarer,
        contract,
        call,
        friend,
        trick_no,
        plays,
        tricks,
        discards,
        ..
    } = &view.phase
    else {
        return None;
    };
    let me = view.me?;
    let trump = contract.trump;
    let seats = view.rules.players;
    let i_am_friend = *friend == Some(me) || matches!(call, FriendCall::Card(c) if view.hand.contains(c));
    let attacking = me == *declarer || i_am_friend;
    // Seats known to be on my side. A defender learns who the other
    // defenders are once the friend is out, or at once when the
    // declarer plays alone.
    let friends = (0..seats)
        .filter(|&s| s != me)
        .filter(|&s| {
            let on_attack = s == *declarer || *friend == Some(s);
            let known = s == *declarer || friend.is_some() || attacking || *call == FriendCall::Alone;
            known && on_attack == attacking
        })
        .fold(0, |m, s| m | 1 << s);
    let unseen = unseen(view, tricks, plays, *discards);
    let out = || unseen.iter();
    let mighty = view.rules.mighty(trump);
    let mut top_out = [0; 4];
    for c in out().filter(|&c| c != mighty) {
        if let (Some(suit), Some(rank)) = (c.suit(), c.rank()) {
            top_out[suit as usize] = top_out[suit as usize].max(rank);
        }
    }
    Some(Table {
        specials_out: out().any(|c| c.is_joker() || c == mighty),
        trumps_out: out().any(|c| c != mighty && c.suit() == trump),
        top_out,
        bot,
        view,
        me,
        trump,
        mighty,
        trick_no: *trick_no,
        unseen,
        friends,
        attacking,
        called: match call {
            FriendCall::Card(c) if friend.is_none() => Some(*c),
            _ => None,
        },
        // Calling a card shows the declarer lacks it; nothing else does.
        spared: if attacking && me != *declarer {
            let shown = match call {
                FriendCall::Card(c) => CardSet::of(*c),
                _ => CardSet::EMPTY,
            };
            view.rules.deck.jokers().iter().collect::<CardSet>() - shown
        } else {
            CardSet::EMPTY
        },
    })
}

/// What leading each kind of card scores, against a side ace's
/// [`LEAD_SIDE_ACE`]; the highest scoring legal lead is played. Cards with
/// a [`power`] add it, so the stronger of a kind leads first.
const LEAD_SIDE_ACE: i32 = 100;
/// Calling a joker that is out against us.
const LEAD_JOKER_CALL: i32 = 300;
/// Calling a joker that is ours, or already gone.
const LEAD_WASTED_CALL: i32 = -50;
/// A joker that would have no power on the last trick, on the trick before
/// it: ahead of even a sure lead, which still wins next trick.
const LEAD_DOOMED_JOKER: i32 = 300;
/// A card nothing unseen can beat.
const LEAD_SURE: i32 = 200;
/// The joker in the late tricks.
const LEAD_LATE_JOKER: i32 = 150;
/// The mighty in the late tricks.
const LEAD_LATE_MIGHTY: i32 = 140;
/// Trump, by the declarer's side, to draw the opponents' trumps.
const LEAD_DRAWING_TRUMP: i32 = 120;
/// Added to a joker the declarer's side leads naming trump.
const LEAD_JOKER_NAMING_TRUMP: i32 = 20;

/// Choosing what to lead.
fn lead_card(t: &Table, legal: &[Action]) -> Action {
    let trumps_out = t.unseen().filter(|c| *c != t.mighty && c.suit() == t.trump).count();
    let my_trumps = t
        .view
        .hand
        .iter()
        .filter(|c| **c != t.mighty && c.suit() == t.trump)
        .count();
    let score = |a: &Action| -> i32 {
        let Action::Play {
            card,
            joker_lead,
            call_joker,
        } = a
        else {
            return i32::MIN;
        };
        let card = *card;
        let p = i32::from(t.power(card));
        if *call_joker {
            // Killing the joker this card calls is worth a lot while it is
            // out against us: not the friend the declarer called, nor, for
            // the friend, a joker the declarer may hold.
            let rules = &t.view.rules;
            let target = rules
                .deck
                .jokers()
                .iter()
                .copied()
                .find(|&j| rules.joker_call_card(j, t.trump) == Some(card));
            let out = target.is_some_and(|j| t.unseen.contains(j));
            let ours = t.attacking && t.called.is_some() && t.called == target;
            let spared = target.is_some_and(|j| t.spared.contains(j));
            return if out && !ours && !spared {
                LEAD_JOKER_CALL
            } else {
                LEAD_WASTED_CALL
            };
        }
        if card.is_joker() {
            // Save the joker for a trick worth taking, unless it cannot wait.
            let named_trump = matches!(joker_lead, Some(Lead::Suit(s)) if Some(*s) == t.trump);
            let base = if t.doomed(card) {
                LEAD_DOOMED_JOKER
            } else if t.late() {
                LEAD_LATE_JOKER
            } else {
                t.bot.lead_joker
            };
            return base
                + if t.attacking && named_trump {
                    LEAD_JOKER_NAMING_TRUMP
                } else {
                    0
                };
        }
        if card == t.mighty {
            return if t.late() { LEAD_LATE_MIGHTY } else { t.bot.lead_mighty };
        }
        let is_trump = card.suit() == t.trump;
        if t.sure_lead(card) {
            return LEAD_SURE + p;
        }
        if t.attacking && is_trump && trumps_out > 0 && my_trumps >= t.bot.draw_trumps {
            // Draw the opponents' trumps, from the top.
            return LEAD_DRAWING_TRUMP + p;
        }
        if !t.attacking && is_trump {
            return t.bot.defend_trump + p;
        }
        if card.rank() == Some(ACE) {
            return LEAD_SIDE_ACE;
        }
        // Otherwise give the lead away cheaply, without handing over points.
        let point_penalty = if card.is_point() { t.bot.lead_point_penalty } else { 0 };
        -p - point_penalty
    };
    legal
        .iter()
        .max_by_key(|a| score(a))
        .cloned()
        .expect("a legal play exists")
}

/// Choosing what to play to a trick someone else led.
fn follow(t: &Table, legal: &[Action], lead: Lead, plays: &[Played], called: Option<Card>) -> Action {
    let rules = &t.view.rules;
    let ctx = rules.trick_context(t.trump, lead);
    let trick = t.trick(Some(lead), called);
    let winner_seat = plays[trick::winner(&ctx, plays)].seat;
    let points = plays.iter().filter(|p| p.card.is_point()).count();
    let seats = t.view.rules.players;
    let mut still_to_play = (1..seats - plays.len()).map(|i| (t.me + i) % seats);
    let last = plays.len() + 1 == seats;
    let friend_winning = t.is_friend(winner_seat);
    let foes_after = still_to_play.any(|s| !t.is_friend(s));

    // The trick with my card added, on the stack: this runs for every card.
    let wins = |card: Card| {
        let mut next = [plays[0]; MAX_PLAYERS];
        next[..plays.len()].copy_from_slice(plays);
        next[plays.len()] = trick.played(rules, t.me, card);
        trick::winner(&ctx, &next[..=plays.len()]) == plays.len()
    };
    let cards: Vec<Card> = legal.iter().map(card_of).collect();
    let pick = |card: Card| {
        legal
            .iter()
            .find(|a| card_of(a) == card)
            .cloned()
            .expect("chosen from legal")
    };

    // The winning card is safe if nobody after me could take it.
    let winning_card = plays.iter().find(|p| p.seat == winner_seat).map(|p| p.card);
    let safe = |card: Option<Card>| {
        !foes_after
            || card.is_some_and(|c| (c == t.mighty || c.is_joker()) && t.powered(c, called))
            || card.is_some_and(|c| t.sure_lead(c))
    };

    if friend_winning && (safe(winning_card) || last) {
        // Feed points, from the cards least likely to win anything later.
        let feed = cards
            .iter()
            .copied()
            .filter(|c| c.is_point() && *c != t.mighty && !c.is_joker() && c.suit() != t.trump && !t.sure_lead(*c))
            .min_by_key(|c| t.power(*c));
        return pick(feed.unwrap_or_else(|| cheapest_dump(t, &cards)));
    }

    let winners: Vec<Card> = cards.iter().copied().filter(|c| wins(*c)).collect();
    let worth = points + usize::from(t.late()) * 2;
    let take = winners
        .iter()
        .copied()
        .filter(|&c| {
            let special = c == t.mighty || c.is_joker();
            // Big guns only for tricks worth it; cheap winners whenever they hold.
            !special || worth >= t.bot.special_worth || last && points >= 1
        })
        .filter(|&c| last || !foes_after || safe(Some(c)) || t.power(c) >= BIG_CARD || points == 0)
        .min_by_key(|c| t.keep(*c));
    match take {
        Some(card) if !friend_winning => pick(card),
        _ => pick(cheapest_dump(t, &cards)),
    }
}

/// The card that costs the least to give away: never the mighty or a
/// joker if anything else will do (unless the joker would be powerless on
/// the last trick anyway), then not a point, then the lowest.
fn cheapest_dump(t: &Table, cards: &[Card]) -> Card {
    *cards
        .iter()
        .min_by_key(|&&c| {
            let special = (c == t.mighty || c.is_joker()) && !t.doomed(c);
            (special, c.is_point(), t.keep(c))
        })
        .expect("a legal play exists")
}

#[cfg(test)]
mod tests {
    use super::*;

    use engine::{Game, Viewer};
    use mighty::{State, testing};
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    /// Regressions: at 3 and 4 players the never-dealt low cards counted as
    /// unseen, so the bot played against phantom trumps; and the declarer
    /// counted its own discards as unseen, playing against cards it had
    /// buried itself. Through whole games of bots, every seat's unseen
    /// cards are exactly the dealt cards it has not seen, the declarer's
    /// discards being seen by the declarer.
    #[test]
    fn unseen_cards_are_never_undealt_cards() {
        let mut declarer_with_discards = 0;
        for players in [3, 4, 5] {
            let rules = Rules::web_mighty().for_players(players).unwrap();
            let dealt = rules.card_set();
            let mut rng = StdRng::seed_from_u64(players as u64);
            for game in 0..20 {
                let mut plays = 0;
                let mut tempered_bots = |state: &State, seat: Seat, legal: &[Action], rng: &mut dyn RngCore| {
                    Bot::<Mighty>::act(
                        &mut tempered(seat),
                        &Mighty::view(state, Viewer::Seat(seat)),
                        legal,
                        rng,
                    )
                };
                let options = testing::options(&rules, game);
                let state = testing::play_hand(&options, &mut rng, &mut tempered_bots, &mut |state, seat| {
                    let view = Mighty::view(state, Viewer::Seat(seat));
                    let bot = tempered(seat);
                    if let Some(t) = table(&bot, &Seen::of_view(&view)) {
                        plays += 1;
                        let PhaseView::Play {
                            tricks,
                            plays,
                            discards,
                            ..
                        } = &view.phase
                        else {
                            unreachable!()
                        };
                        let seen: CardSet = (tricks.iter().flat_map(|t| &t.plays).chain(plays))
                            .map(|p| p.card)
                            .chain(view.hand.iter().copied())
                            .chain(discards.iter().flatten().copied())
                            .collect();
                        if let Some(discards) = discards {
                            assert!(discards.iter().all(|&c| !t.unseen.contains(c)));
                            declarer_with_discards += 1;
                        }
                        assert!((t.unseen - dealt).is_empty(), "{players} players: undealt cards unseen");
                        assert_eq!(t.unseen, dealt - seen);
                        assert!(t.trumps_out == t.unseen().any(|c| c != t.mighty && c.suit() == t.trump));
                    }
                    true
                });
                assert!(plays > 0 || Mighty::payoffs(&state).is_some());
            }
        }
        assert!(declarer_with_discards > 100, "{declarer_with_discards}");
    }
}
