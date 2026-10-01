//! A rule-based bot: good enough to fill an empty seat, nothing more.

use crate::Mighty;
use crate::card::{ACE, Card, Suit};
use crate::rules::CardPolicy;
use crate::state::{Action, FriendCall};
use crate::trick::{self, Played, TrickContext};
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

/// Rough number of points this hand could promise with `trump`.
fn estimate(view: &View, trump: Suit) -> u8 {
    let mighty = view.rules.mighty(Some(trump));
    let hand = &view.hand;
    let trumps = hand.iter().filter(|c| c.suit() == Some(trump) && **c != mighty).count();
    let jokers = hand.iter().filter(|c| c.is_joker()).count();
    let aces = hand
        .iter()
        .filter(|c| c.rank() == Some(ACE) && c.suit() != Some(trump))
        .count();
    (5 + trumps + 2 * usize::from(hand.contains(&mighty)) + 2 * jokers + aces) as u8
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
        let worst = view
            .hand
            .iter()
            .min_by_key(|&&c| (power(view, trump, c), c.is_point()))?;
        return Some(Action::Discard(*worst));
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
        ..
    } = &view.phase
    else {
        return None;
    };
    let Viewer::Seat(me) = view.viewer else { return None };
    let trump = contract.trump;
    let i_am_friend = *friend == Some(me) || matches!(call, FriendCall::Card(c) if view.hand.contains(c));
    let teammate = |s: Seat| {
        if me == *declarer {
            *friend == Some(s)
        } else if i_am_friend {
            s == *declarer
        } else {
            friend.is_some() && s != *declarer && *friend != Some(s)
        }
    };
    let card_of = |a: &Action| match a {
        Action::Play { card, .. } => *card,
        _ => unreachable!("only plays are legal during play"),
    };
    let by_power = |a: &&Action| power(view, trump, card_of(a));

    let Some(lead) = lead else {
        let on_attack = me == *declarer || i_am_friend;
        return if on_attack {
            legal.iter().max_by_key(by_power)
        } else {
            legal.iter().min_by_key(by_power)
        }
        .cloned();
    };

    let ctx = TrickContext {
        trump,
        mighty: view.rules.mighty(trump),
        deck: view.rules.deck,
        lead: *lead,
    };
    let winning = plays[trick::winner(&ctx, plays)].seat;
    if teammate(winning) {
        return legal.iter().min_by_key(by_power).cloned();
    }
    let wins = |a: &&Action| {
        let card = card_of(a);
        let called_powerless = *called_joker == Some(card) && !view.rules.joker_call.called_joker_has_power;
        let powered = view.rules.policy(card, trump, *trick_no) != CardPolicy::NoEffect && !called_powerless;
        let mut next = plays.clone();
        next.push(Played {
            seat: me,
            card,
            powered,
        });
        trick::winner(&ctx, &next) == next.len() - 1
    };
    legal
        .iter()
        .filter(wins)
        .min_by_key(by_power)
        .or_else(|| legal.iter().min_by_key(by_power))
        .cloned()
}
