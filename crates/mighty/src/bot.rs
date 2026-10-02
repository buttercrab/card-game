//! A rule-based bot. It fills an empty seat on its own, and it plays every
//! seat inside the search bot's playouts, so the search is only as good as
//! these rules.

use crate::Mighty;
use crate::card::{ACE, Card, Suit};
use crate::rules::{CardPolicy, Rules};
use crate::state::{Action, FriendCall};
use crate::trick::{self, Lead, Played, TrickContext};
use crate::view::{PhaseView, View};
use engine::{Bot, Seat, Viewer};
use rand::RngCore;

#[derive(Debug, Clone, Copy, Default)]
pub struct SimpleBot;

impl Bot<Mighty> for SimpleBot {
    fn act(&mut self, view: &View, legal: &[Action], _rng: &mut dyn RngCore) -> Action {
        let choice = match &view.phase {
            PhaseView::Bidding { .. } => bid(view, legal),
            PhaseView::Exchange { contract, .. } => exchange(view, legal, contract.trump),
            PhaseView::Play { .. } => play(view, legal),
            PhaseView::Dealing | PhaseView::Done { .. } => None,
        };
        choice.unwrap_or_else(|| legal[0].clone())
    }
}

const BID_BASE: usize = 6;

/// Rough number of points a hand could promise with `trump` (`None` for
/// no-trump): long trump, the mighty, jokers and side aces (the mighty
/// counts twice over when it is an ace; tuned that way).
fn strength(rules: &Rules, hand: &[Card], trump: Option<Suit>) -> u8 {
    let mighty = rules.mighty(trump);
    let trumps = hand
        .iter()
        .filter(|c| c.suit() == trump && trump.is_some() && **c != mighty)
        .count();
    let jokers = hand.iter().filter(|c| c.is_joker()).count();
    let aces = hand
        .iter()
        .filter(|c| c.rank() == Some(ACE) && c.suit() != trump)
        .count();
    (BID_BASE + trumps + 2 * usize::from(hand.contains(&mighty)) + 2 * jokers + aces) as u8
}

fn estimate(view: &View, trump: Suit) -> u8 {
    strength(&view.rules, &view.hand, Some(trump))
}

fn bid(view: &View, legal: &[Action]) -> Option<Action> {
    if legal.contains(&Action::Misdeal) {
        return Some(Action::Misdeal);
    }
    let trump = Suit::ALL.into_iter().max_by_key(|&s| estimate(view, s))?;
    let cheapest = legal
        .iter()
        .filter_map(|a| match a {
            Action::Bid(c) if c.trump == Some(trump) => Some(*c),
            _ => None,
        })
        .min_by_key(|c| c.count);
    match cheapest {
        Some(c) if c.count <= estimate(view, trump) || !legal.contains(&Action::Pass) => Some(Action::Bid(c)),
        _ => Some(Action::Pass),
    }
}

/// How much a card is worth keeping: the mighty, then jokers, then trumps
/// by rank, then everything else by rank.
fn power(view: &View, trump: Option<Suit>, card: Card) -> u8 {
    if card == view.rules.mighty(trump) {
        100
    } else if card.is_joker() {
        90
    } else if card.suit() == trump {
        40 + card.rank().unwrap_or(0)
    } else {
        card.rank().unwrap_or(0)
    }
}

fn exchange(view: &View, legal: &[Action], trump: Option<Suit>) -> Option<Action> {
    if legal.iter().any(|a| matches!(a, Action::Discard(_))) {
        return discard(view, legal, trump);
    }
    let wanted = [
        FriendCall::Card(view.rules.mighty(trump)),
        FriendCall::Card(view.rules.deck.jokers()[0]),
    ]
    .into_iter()
    .chain(trump.map(|t| FriendCall::Card(Card::new(t, ACE))))
    .filter(|call| !matches!(call, FriendCall::Card(c) if view.hand.contains(c)))
    .chain([FriendCall::FirstTrick]);
    wanted.map(Action::CallFriend).find(|a| legal.contains(a))
}

/// Discarded point cards still count for the declarer, so side-suit tens to
/// kings are best put back: they are points banked. After them, the
/// shortest side suits go, to make voids that trump can ruff.
fn discard(view: &View, legal: &[Action], trump: Option<Suit>) -> Option<Action> {
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
    view: &'a View,
    me: Seat,
    trump: Option<Suit>,
    mighty: Card,
    trick_no: usize,
    /// Every card not in my hand and not yet played.
    unseen: Vec<Card>,
    /// Seats known to be on my side, and known to be against me.
    friends: Vec<Seat>,
    attacking: bool,
    /// The card the declarer called, while its holder is unknown.
    called: Option<Card>,
}

impl Table<'_> {
    fn power(&self, card: Card) -> u8 {
        power(self.view, self.trump, card)
    }

    fn powered(&self, card: Card, called: Option<Card>) -> bool {
        let rules = &self.view.rules;
        let called_powerless = called == Some(card) && !rules.joker_call.called_joker_has_power;
        rules.policy(card, self.trump, self.trick_no) != CardPolicy::NoEffect && !called_powerless
    }

    /// No unseen card can beat this one if it is led: it is the mighty, or
    /// the top of its suit with the mighty and jokers already gone.
    fn sure_lead(&self, card: Card) -> bool {
        if card == self.mighty {
            return true;
        }
        let Some(suit) = card.suit() else { return false };
        let specials_out = self.unseen.iter().any(|c| c.is_joker() || *c == self.mighty);
        let higher_out = self
            .unseen
            .iter()
            .any(|c| *c != self.mighty && c.suit() == Some(suit) && c.rank() > card.rank());
        let trumps_out = self.unseen.iter().any(|c| *c != self.mighty && c.suit() == self.trump);
        let ruffable = Some(suit) != self.trump && trumps_out;
        !specials_out && !higher_out && !ruffable
    }

    fn late(&self) -> bool {
        self.trick_no + 3 >= self.view.rules.hand_size
    }
}

fn card_of(a: &Action) -> Card {
    match a {
        Action::Play { card, .. } => *card,
        _ => unreachable!("only plays are legal during play"),
    }
}

fn play(view: &View, legal: &[Action]) -> Option<Action> {
    let PhaseView::Play {
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
    } = &view.phase
    else {
        return None;
    };
    let Viewer::Seat(me) = view.viewer else { return None };
    let trump = contract.trump;
    let seats = view.rules.players;
    let i_am_friend = *friend == Some(me) || matches!(call, FriendCall::Card(c) if view.hand.contains(c));
    let attacking = me == *declarer || i_am_friend;
    // Seats known to be on my side. A defender learns who the other
    // defenders are only once the friend is out.
    let friends: Vec<Seat> = (0..seats)
        .filter(|&s| s != me)
        .filter(|&s| {
            let on_attack = s == *declarer || *friend == Some(s);
            let known = s == *declarer || friend.is_some() || attacking;
            known && on_attack == attacking
        })
        .collect();
    let played: Vec<Card> = tricks
        .iter()
        .flat_map(|t| t.plays.iter().map(|p| p.card))
        .chain(plays.iter().map(|p| p.card))
        .collect();
    let unseen: Vec<Card> = view
        .rules
        .deck
        .cards()
        .into_iter()
        .filter(|c| !view.hand.contains(c) && !played.contains(c))
        .collect();
    let t = Table {
        view,
        me,
        trump,
        mighty: view.rules.mighty(trump),
        trick_no: *trick_no,
        unseen,
        friends,
        attacking,
        called: match call {
            FriendCall::Card(c) if friend.is_none() => Some(*c),
            _ => None,
        },
    };

    match lead {
        None => Some(lead_card(&t, legal)),
        Some(lead) => Some(follow(&t, legal, *lead, plays, *called_joker)),
    }
}

/// Choosing what to lead.
fn lead_card(t: &Table, legal: &[Action]) -> Action {
    let joker_out = t.unseen.iter().any(|c| c.is_joker());
    let trumps_out = t
        .unseen
        .iter()
        .filter(|c| **c != t.mighty && c.suit() == t.trump)
        .count();
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
            // Killing a joker that is probably against us is worth a lot,
            // unless it is the friend the declarer called.
            let ours = t.attacking && t.called.is_some_and(|c| c.is_joker());
            return if joker_out && !ours { 300 } else { -50 };
        }
        if card.is_joker() {
            // Save the joker for a trick worth taking, unless it cannot wait.
            let named_trump = matches!(joker_lead, Some(Lead::Suit(s)) if Some(*s) == t.trump);
            let base = if t.late() { 150 } else { -40 };
            return base + if t.attacking && named_trump { 20 } else { 0 };
        }
        if card == t.mighty {
            return if t.late() { 140 } else { -60 };
        }
        let is_trump = card.suit() == t.trump;
        if t.sure_lead(card) {
            return 200 + p;
        }
        if t.attacking && is_trump && trumps_out > 0 && my_trumps >= 4 {
            // Draw the opponents' trumps, from the top.
            return 120 + p;
        }
        if !t.attacking && is_trump {
            return -100 + p;
        }
        if card.rank() == Some(ACE) {
            return 100;
        }
        // Otherwise give the lead away cheaply, without handing over points.
        let point_penalty = if card.is_point() { 30 } else { 0 };
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
    let ctx = TrickContext {
        trump: t.trump,
        mighty: t.mighty,
        deck: t.view.rules.deck,
        lead,
        powerless_joker_passes: t.view.rules.joker_lead.powerless_passes,
    };
    let winner_seat = plays[trick::winner(&ctx, plays)].seat;
    let points = plays.iter().filter(|p| p.card.is_point()).count();
    let seats = t.view.rules.players;
    let still_to_play: Vec<Seat> = (1..seats - plays.len()).map(|i| (t.me + i) % seats).collect();
    let last = still_to_play.is_empty();
    let friend_winning = t.friends.contains(&winner_seat);
    let foes_after = still_to_play.iter().any(|s| !t.friends.contains(s));

    let after = |card: Card| {
        let mut next = plays.to_vec();
        next.push(Played {
            seat: t.me,
            card,
            powered: t.powered(card, called),
        });
        next
    };
    let wins = |card: Card| trick::winner(&ctx, &after(card)) == plays.len();
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
            !special || worth >= 2 || last && points >= 1
        })
        .filter(|&c| last || !foes_after || safe(Some(c)) || t.power(c) >= 50 || points == 0)
        .min_by_key(|c| t.power(*c));
    match take {
        Some(card) if !friend_winning => pick(card),
        _ => pick(cheapest_dump(t, &cards)),
    }
}

/// The card that costs the least to give away: low, and not a point.
fn cheapest_dump(t: &Table, cards: &[Card]) -> Card {
    *cards
        .iter()
        .min_by_key(|c| (c.is_point(), t.power(**c)))
        .expect("a legal play exists")
}
